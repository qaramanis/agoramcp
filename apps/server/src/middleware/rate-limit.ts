import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";

/**
 * Per-client, per-source budget. Keyed by path as well as address so a caller
 * hammering one source cannot exhaust another's allowance.
 *
 * Returns undefined when limiting is switched off.
 */
export function createRateLimiter(perMinute: number): MiddlewareHandler | undefined {
  if (perMinute <= 0) return undefined;

  return rateLimiter({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-7",
    keyGenerator: (c) => `${clientAddress(c)}:${c.req.path}`,
    message: {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Rate limit exceeded for this source. Try again in a minute.",
      },
      id: null,
    },
  });
}

/**
 * Behind Caddy the socket address is the proxy, so prefer the forwarded chain's
 * first entry. Only safe because nothing but our own proxy is upstream.
 */
function clientAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return getConnInfo(c).remote.address ?? "unknown";
}
