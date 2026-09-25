import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * Who is asking, without an account. One definition for the whole system:
 * the web app's country form, its /live proxy and the server's rate limiter
 * all call `requesterId`, so a person is the same requester whichever door
 * they came in by — one vote per country, one budget per source.
 *
 * The id is a keyed hash (HMAC-SHA256) of the client's address and nothing
 * else. Not the user agent: a caller writes that header itself, so a new one
 * would be a new person, a second vote and a fresh budget. The key is
 * `REQUEST_HASH_SALT`, the same on every deployment of both apps, and it is
 * what stops the id being reversed by hashing candidate addresses.
 *
 * Imported by the web app as `@agoramcp/core/requester`, so this file must
 * stay free of the rest of the package.
 */

/** The header the /live proxy names its visitor in, as a `requesterId`. */
export const REQUESTER_HEADER = "x-agoramcp-requester";

/** The header that proves a request came from the web app: `PROXY_SECRET`, verbatim. */
export const PROXY_HEADER = "x-agoramcp-proxy";

/** What a `requesterId` looks like, for checking one that arrived in a header. */
export const REQUESTER_ID = /^[0-9a-f]{64}$/;

export function requesterId(address: string, salt: string): string {
  return createHmac("sha256", salt).update(requesterKey(address)).digest("hex");
}

/**
 * The part of an address that names one requester. IPv4 whole. IPv6 by its
 * /64: a household or a phone is handed a /64 and picks addresses inside it
 * at will — privacy extensions rotate them daily — so the whole address
 * would make one person many. An IPv4-mapped IPv6 address is its IPv4.
 * Anything that is not an address is used as it came.
 */
export function requesterKey(address: string): string {
  const bare = (address.trim().replace(/^\[|\]$/g, "").split("%")[0] ?? "").toLowerCase();

  switch (isIP(bare)) {
    case 4:
      return bare;
    case 6: {
      const groups = ipv6Groups(bare);
      const [g6 = 0, g7 = 0] = groups.slice(6);
      if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
        return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
      }
      return `${groups
        .slice(0, 4)
        .map((group) => group.toString(16))
        .join(":")}::/64`;
    }
    default:
      return bare;
  }
}

/** A valid IPv6 address as its eight 16-bit groups, `::` and a trailing dotted IPv4 expanded. */
function ipv6Groups(address: string): number[] {
  let text = address;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head = "", tail] = text.split("::");
  const parse = (part: string | undefined) =>
    part ? part.split(":").map((group) => Number.parseInt(group, 16)) : [];
  const front = parse(head);
  const back = parse(tail);
  const gap = tail === undefined ? 0 : 8 - front.length - back.length;

  return [...front, ...new Array<number>(gap).fill(0), ...back];
}

/** Whether a presented secret is the expected one, in time that does not depend on how much of it matched. */
export function secretMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  // Hashed first so the comparison is between equal lengths, as timingSafeEqual requires.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}
