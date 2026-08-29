import type { Logger } from "@agoramcp/core";
import type { MiddlewareHandler } from "hono";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    logger: Logger;
  }
}

/**
 * One structured line per request, plus an `x-request-id` the caller can quote
 * when reporting a problem.
 */
export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    const startedAt = Date.now();

    c.set("requestId", requestId);
    c.set("logger", logger.child({ requestId }));
    c.header("x-request-id", requestId);

    try {
      await next();
    } finally {
      logger.info("request", {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      });
    }
  };
}
