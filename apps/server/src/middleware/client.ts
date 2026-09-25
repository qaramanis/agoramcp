import { PROXY_HEADER, REQUESTER_HEADER, REQUESTER_ID, requesterId, secretMatches } from "@agoramcp/core";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Who is calling. Behind a proxy the socket address is the proxy, so prefer
 * the forwarded chain's first entry — only safe because nothing but our own
 * proxy is upstream. For the rate limiter alone: the privacy page promises
 * the address is held for the limiter's minute and written nowhere, so it
 * must never reach a log line.
 */
export function clientAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return getConnInfo(c).remote.address ?? "unknown";
}

export interface IdentifyOptions {
  /** `REQUEST_HASH_SALT`. Unset, a caller is keyed by their address as it came. */
  salt: string | undefined;
  /** `PROXY_SECRET`. Unset, no request is trusted to name its own requester. */
  proxySecret: string | undefined;
}

/**
 * The requester a request counts against: the same `requesterId` the web app
 * files a country request under, so one person has one budget whether they
 * call the API, an MCP mount or the /live playground.
 *
 * The playground reaches us from the web app's own address, which would put
 * every visitor on one budget, so the proxy names its visitor in
 * `x-agoramcp-requester`. That header is believed only beside the proxy's
 * secret: from anyone else it is ignored, or a script could name a fresh
 * requester on every call and never meet the limit.
 */
export function createIdentify({ salt, proxySecret }: IdentifyOptions): (c: Context) => string {
  return (c) => {
    if (proxySecret && secretMatches(c.req.header(PROXY_HEADER), proxySecret)) {
      const named = c.req.header(REQUESTER_HEADER);
      if (named && REQUESTER_ID.test(named)) return named;
    }
    const address = clientAddress(c);
    return salt ? requesterId(address, salt) : address;
  };
}
