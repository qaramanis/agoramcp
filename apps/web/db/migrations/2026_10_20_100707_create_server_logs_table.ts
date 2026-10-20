import type { Sql } from "../client";

/**
 * The server's warnings and errors, kept after the host's own logs are gone:
 * Vercel's free plan holds a function's output for an hour. One row per
 * `warn` or `error` line, and `line` is that line exactly as stdout got it;
 * the columns beside it are what a read filters on. The server writes the
 * rows (`apps/server/src/record.ts`) and the status cron deletes them after
 * `LOG_RETENTION_DAYS`. `request_id` joins a line to its `tool_calls` row.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`
    create table server_logs (
      id         bigserial   primary key,
      logged_at  timestamptz not null,
      level      text        not null,
      message    text        not null,
      request_id text,
      line       jsonb       not null
    )`;
  await sql`create index server_logs_logged_at on server_logs (logged_at)`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop table if exists server_logs`;
}
