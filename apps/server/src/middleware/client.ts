import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Who is calling. Behind a proxy the socket address is the proxy, so prefer
 * the forwarded chain's first entry — only safe because nothing but our own
 * proxy is upstream. Shared by the rate limiter and the request line, so the
 * budget and the log name the same caller.
 */
export function clientAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return getConnInfo(c).remote.address ?? "unknown";
}
