import type { LogEntry, Logger } from "@agoramcp/core";
import { waitUntil } from "@vercel/functions";
import postgres from "postgres";
import type { ToolCallRecord } from "./call.ts";
import type { RpcSummary } from "./middleware/logging.ts";

export type Sql = postgres.Sql;
export type CallRecorder = (record: ToolCallRecord) => void;
export type ClientRecorder = (client: NonNullable<RpcSummary["client"]>) => void;

/**
 * What the server writes to the web app's database: each call's outcome,
 * each client that connects, and its own warnings and errors. The tables are
 * made by the web app's migrations (`apps/web/db/migrations`); this only
 * inserts.
 *
 * Every write is off the response path: it is handed to `waitUntil`, which on
 * Vercel keeps the instance alive until it settles and anywhere else is a
 * no-op on a promise that completes on its own. A row that cannot be written
 * is a warning, never a failed request.
 */
export function connect(databaseUrl: string): Sql {
  // Shaped like the web app's own connection: a small pool, idle connections
  // let go quickly, no prepared statements for Neon's pooled endpoint.
  return postgres(databaseUrl, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });
}

/** One row per finished call in `tool_calls`, the table the status page reads its 90-day history from. */
export function createCallRecorder(sql: Sql, logger: Logger): CallRecorder {
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

/**
 * The longest client name or version kept. The caller writes both, and a
 * row a day per pair is only small while the pair is.
 */
const CLIENT_FIELD_MAX = 100;

/** Adds one to today's count for the client an `initialize` named, in `mcp_clients`. */
export function createClientRecorder(sql: Sql, logger: Logger): ClientRecorder {
  return (client) => {
    const name = client.name.slice(0, CLIENT_FIELD_MAX);
    const version = client.version.slice(0, CLIENT_FIELD_MAX);
    const upsert = sql`
      insert into mcp_clients (day, name, version, connections)
      values ((now() at time zone 'utc')::date, ${name}, ${version}, 1)
      on conflict (day, name, version) do update set connections = mcp_clients.connections + 1`.then(
      () => undefined,
      (error: unknown) => {
        logger.warn("record.failed", { client: { name, version }, error });
      },
    );
    waitUntil(upsert);
  };
}

/**
 * The logger's `write` once there is a database: every line to stdout as
 * before, and each `warn` and `error` line also into `server_logs`, so it
 * outlives the host's own logs. A line that cannot be kept is reported to
 * `fallback`, a logger that writes to stdout only: through this one, the
 * report would try the database again, and fail again.
 */
export function keepLogs(sql: Sql, fallback: Logger): (line: string, entry: LogEntry) => void {
  return (line, entry) => {
    process.stdout.write(`${line}\n`);
    if (entry.level !== "warn" && entry.level !== "error") return;

    const requestId = typeof entry.requestId === "string" ? entry.requestId : null;
    // The line goes in as text and is cast after: a parameter Postgres reads
    // as jsonb, the driver serialises again, and the row holds a string.
    const insert = sql`
      insert into server_logs (logged_at, level, message, request_id, line)
      values (${entry.time}, ${entry.level}, ${entry.message}, ${requestId}, ${line}::text::jsonb)`.then(
      () => undefined,
      (error: unknown) => {
        fallback.warn("log.failed", { requestId: requestId ?? undefined, logged: entry.message, error });
      },
    );
    waitUntil(insert);
  };
}
