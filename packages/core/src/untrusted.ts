import { lookup as dnsLookup } from "node:dns";
import { Agent as HttpAgent, request as httpRequest, type IncomingMessage } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable, pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

/**
 * Fetching a URL nobody here wrote. A catalogue record's link is whatever its
 * publisher typed, and a publisher — or whoever holds a domain a publisher
 * let lapse — can point it at `127.0.0.1`, a cloud metadata address, or a
 * public page that redirects to one. Fetched with a plain `fetch`, the answer
 * would come back to the caller.
 *
 * The check is made where the socket is opened, on the address actually
 * dialled: once per redirect hop, and after DNS rather than before it, so a
 * name that resolves one way when checked and another when connected cannot
 * slip through. `fetch` gives no hook at that point without undici, which is
 * CommonJS and does not survive the ESM bundle Vercel builds, so this is
 * `node:http` with a guarded `lookup`, answering with a standard `Response`.
 */

/** A URL `fetchUntrusted` would not connect to. The message says which host and why. */
export class RefusedAddressError extends Error {
  readonly host: string;

  constructor(host: string, message: string) {
    super(message);
    this.name = "RefusedAddressError";
    this.host = host;
  }
}

/**
 * IPv4 ranges that are not the public internet (IANA special-purpose
 * registry). Node's `BlockList` also matches an IPv4-mapped IPv6 address
 * (`::ffff:127.0.0.1`) against these, so they cover that spelling too.
 */
const NON_PUBLIC_V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * IPv6 is the other way round: only global unicast (`2000::/3`) is public,
 * less the blocks inside it that are not — protocol assignments, 6to4,
 * documentation. Loopback, link-local, unique-local and NAT64 all fall
 * outside `2000::/3` and are refused by that alone.
 */
const NON_PUBLIC_IN_GLOBAL_V6: readonly [string, number][] = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
];

const nonPublicV4 = new BlockList();
for (const [network, prefix] of NON_PUBLIC_V4) nonPublicV4.addSubnet(network, prefix, "ipv4");

const mappedV4 = new BlockList();
mappedV4.addSubnet("::ffff:0:0", 96, "ipv6");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

const nonPublicInGlobalV6 = new BlockList();
for (const [network, prefix] of NON_PUBLIC_IN_GLOBAL_V6) nonPublicInGlobalV6.addSubnet(network, prefix, "ipv6");

/** Whether an IP address is on the public internet. Anything that is not an IP address is not. */
export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !nonPublicV4.check(address, "ipv4");
    case 6:
      if (mappedV4.check(address, "ipv6")) return !nonPublicV4.check(address, "ipv6");
      return globalV6.check(address, "ipv6") && !nonPublicInGlobalV6.check(address, "ipv6");
    default:
      return false;
  }
}

function refused(host: string, address: string): RefusedAddressError {
  const where = host === address ? host : `${host} (${address})`;
  return new RefusedAddressError(host, `${where} is not a public internet address.`);
}

/**
 * DNS as the socket sees it, refusing a name when any address it resolves to
 * is not public — every one is checked, since the socket may dial any of
 * them. Answers in whichever shape the socket asked for.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");

    const bad = addresses.find((entry) => !isPublicAddress(entry.address));
    if (bad) return callback(refused(hostname, bad.address), "");

    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(Object.assign(new Error(`${hostname} did not resolve.`), { code: "ENOTFOUND" }), "");
    callback(null, first.address, first.family);
  });
};

/** Its own agents, so no socket opened without the guard is ever reused for a request made with it. */
const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/** Statuses a `Response` must be built without a body. */
const NULL_BODY = new Set([204, 205, 304]);

export interface UntrustedRequestInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * A GET for a URL someone else supplied: http or https only, only to public
 * addresses, redirects followed (up to five) under the same rules, and the
 * body inflated as `fetch` would. A refusal is thrown as a
 * `RefusedAddressError`; anything else as the error the socket raised.
 */
export async function fetchUntrusted(url: string, init: UntrustedRequestInit = {}): Promise<Response> {
  let target = parseTarget(url);

  for (let redirects = 0; ; redirects += 1) {
    const message = await get(target, init);
    const location = message.headers.location;

    if (!REDIRECT.has(message.statusCode ?? 0) || !location) return toResponse(message);

    message.resume();
    if (redirects === MAX_REDIRECTS) {
      throw new Error(`${url} redirected more than ${MAX_REDIRECTS} times.`);
    }
    target = parseTarget(new URL(location, target).toString());
  }
}

function parseTarget(url: string): URL {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new RefusedAddressError(url, `${url} is not a web address.`);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new RefusedAddressError(target.host, `${url} is not an http or https address.`);
  }
  return target;
}

function get(target: URL, init: UntrustedRequestInit): Promise<IncomingMessage> {
  // A host given as an IP literal is dialled directly and never reaches the
  // lookup, so it is checked here.
  const host = target.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicAddress(host)) return Promise.reject(refused(host, host));

  const https = target.protocol === "https:";

  return new Promise((resolve, reject) => {
    const request = (https ? httpsRequest : httpRequest)(target, {
      agent: https ? httpsAgent : httpAgent,
      lookup: publicLookup,
      headers: { "accept-encoding": "gzip, deflate, br", ...init.headers },
      ...(init.signal ? { signal: init.signal } : {}),
    });
    request.once("response", resolve);
    request.once("error", reject);
    request.end();
  });
}

function toResponse(message: IncomingMessage): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry);
  }

  const status = message.statusCode ?? 502;
  if (NULL_BODY.has(status)) {
    message.resume();
    return new Response(null, { status, statusText: message.statusMessage, headers });
  }

  return new Response(Readable.toWeb(inflated(message)) as ReadableStream<Uint8Array>, {
    status,
    statusText: message.statusMessage,
    headers,
  });
}

/**
 * The body as sent, or inflated when the server compressed it. Inflation is
 * streamed, so a reader that stops at a byte cap stops the download with it.
 */
function inflated(message: IncomingMessage): Readable {
  const encoding = (message.headers["content-encoding"] ?? "").trim().toLowerCase();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? createGunzip()
      : encoding === "deflate"
        ? createInflate()
        : encoding === "br"
          ? createBrotliDecompress()
          : undefined;
  if (!decoder) return message;
  // A failure on either side destroys both, which the reader sees as an error.
  return pipeline(message, decoder, () => undefined);
}
