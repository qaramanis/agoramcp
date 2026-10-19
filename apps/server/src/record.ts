import type { Logger } from "@agoramcp/core";
import { waitUntil } from "@vercel/functions";
import postgres from "postgres";
import type { ToolCallRecord } from "./call.ts";

export type CallRecorder = (record: ToolCallRecord) => void;

/**
 * Writes each finished call to `tool_calls`, the table the status page reads
 * its 90-day history from. The table is made by the web app's migrations
 * (`apps/web/db/migrations`); this only inserts.
 *
 * One row per call, written off the response path: the insert is handed to
 * `waitUntil`, which on Vercel keeps the instance alive until it settles and
 * anywhere else is a no-op on a promise that completes on its own. A row
 * that cannot be written is a warning, never a failed call.
 */
export function createCallRecorder(databaseUrl: string, logger: Logger): CallRecorder {
  // Shaped like the web app's own connection: a small pool, idle connections
  // let go quickly, no prepared statements for Neon's pooled endpoint.
  const sql = postgres(databaseUrl, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });

  return (record) => {
    const insert = sql`
      insert into tool_calls (called_at, source, tool, transport, ok, code, duration_ms, cached, request_id)
      values (
        ${record.calledAt}, ${record.source}, ${record.tool}, ${record.transport},
        ${record.ok}, ${record.code}, ${record.durationMs}, ${record.cached}, ${record.requestId}
      )`.then(
      () => undefined,
      (error: unknown) => {
        logger.warn("record.failed", {
          requestId: record.requestId,
          source: record.source,
          tool: record.tool,
          error,
        });
      },
    );
    waitUntil(insert);
  };
}
