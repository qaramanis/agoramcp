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
