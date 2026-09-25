import type { Context, MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";

export interface RateLimitOptions {
  /**
   * What one budget covers, given the request. Defaults to the request path,
   * which on the MCP mounts is the source. The API mounts the tool as a path
   * segment too, so they pass a scope that stops at the source.
   */
  scope?: (c: Context) => string;
  /** The body a refused request is sent. Defaults to the JSON-RPC error the MCP mounts speak. */
  message?: string | Record<string, unknown>;
}

const JSON_RPC_MESSAGE: Record<string, unknown> = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message: "Rate limit exceeded for this source. Try again in a minute.",
  },
  id: null,
};

/**
 * Per-requester, per-source budget. Keyed by scope as well as requester so a
 * caller hammering one source cannot exhaust another's allowance. `identify`
 * names the requester (`createIdentify`).
 *
 * Returns undefined when limiting is switched off.
 */
export function createRateLimiter(
  perMinute: number,
  identify: (c: Context) => string,
  options: RateLimitOptions = {},
): MiddlewareHandler | undefined {
  if (perMinute <= 0) return undefined;

  const scope = options.scope ?? ((c: Context) => c.req.path);

  return rateLimiter({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-7",
    keyGenerator: (c) => `${identify(c)}:${scope(c)}`,
    message: options.message ?? JSON_RPC_MESSAGE,
  });
}
