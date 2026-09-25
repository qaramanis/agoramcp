import type { Logger } from "@agoramcp/core";
import type { MiddlewareHandler } from "hono";

/**
 * What the JSON-RPC body of an MCP request said, for the request line. Every
 * request to a mount is a POST to the same path; this is what tells one from
 * the next.
 */
export interface RpcSummary {
  /** The method, or the distinct methods of a batch joined with commas. */
  method: string;
  id?: string | number;
  /** Who connected, on `initialize`. */
  client?: { name: string; version: string };
  protocolVersion?: string;
  /** How many messages, when the body was a batch. */
  batch?: number;
}

/** The source and tool a request resolved to, whichever transport carried it. */
export interface CallSummary {
  source: string;
  tool: string;
}

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    logger: Logger;
    rpc?: RpcSummary;
    call?: CallSummary;
  }
}

/**
 * Sent by the status page's probe. A probe is logged like any call and marked
 * as one, so it can be told apart from a person — and it is not recorded,
 * because the probe writes its own row.
 */
export const PROBE_HEADER = "x-agoramcp-probe";

/**
 * A caller's own `x-request-id` is kept when it looks like an id — a UUID, a
 * trace id, `fra1::abc-123` — so their logs and ours join up. Anything
 * longer or stranger is replaced: it goes on every line and into the
 * `tool_calls` table, and is no place for a paragraph.
 */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * One structured line per request, plus an `x-request-id` the caller can quote
 * when reporting a problem. The line is written after the route has run, so
 * it carries what the route found out: the JSON-RPC method behind a POST to
 * a mount, and the source and tool behind a call. It says what was asked,
 * never who asked: no address and no user agent, as the privacy page
 * promises.
 */
export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const given = c.req.header("x-request-id");
    const requestId = given !== undefined && REQUEST_ID.test(given) ? given : crypto.randomUUID();
    const startedAt = Date.now();

    c.set("requestId", requestId);
    c.set("logger", logger.child({ requestId }));
    c.header("x-request-id", requestId);

    try {
      await next();
    } finally {
      const rpc = c.get("rpc");
      const call = c.get("call");
      // Undefined fields fall out of the JSON, so the optional ones cost nothing when absent.
      logger.info("request", {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
        probe: c.req.header(PROBE_HEADER) === undefined ? undefined : true,
        rpcMethod: rpc?.method,
        rpcId: rpc?.id,
        batch: rpc?.batch,
        client: rpc?.client,
        protocolVersion: rpc?.protocolVersion,
        source: call?.source,
        tool: call?.tool,
      });
    }
  };
}
