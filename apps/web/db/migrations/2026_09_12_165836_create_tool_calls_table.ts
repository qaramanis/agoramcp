import type { Sql } from "../client";

/**
 * One row per tool call the MCP server answers, and one per probe the status
 * cron makes — what the status page's 90-day history is read from. Outcome
 * and timing only, never the arguments and never an address; and the raw
 * outcome rather than a verdict: `ok` is whether the handler returned, `code`
 * is the error's own code when it did not, and what counts as the registry's
 * failure rather than the caller's is decided where the rows are read.
 * `source` is the registry key (`gr/vies`) rather than a reference, so a row
 * outlives a source being renamed or unmounted. The server writes the `mcp`
 * and `api` rows (`apps/server/src/record.ts`); the cron writes `probe`.
 * Each index leads with what a read filters on: the history by source and
 * day, the prune by age.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`
    create table tool_calls (
      id          bigserial   primary key,
      called_at   timestamptz not null default now(),
      source      text        not null,
      tool        text        not null,
      transport   text        not null,
      ok          boolean     not null,
      code        text,
      duration_ms integer     not null,
      request_id  text
    )`;
  await sql`create index tool_calls_source_called_at on tool_calls (source, called_at)`;
  await sql`create index tool_calls_called_at on tool_calls (called_at)`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop table if exists tool_calls`;
}
