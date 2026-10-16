import type { Sql } from "../client";

/**
 * The status page now reads its verdict from the monitor's rows instead of
 * calling every registry on every view, so a `probe` row has to carry what
 * the page used to learn from the call itself: why it failed, in the API's
 * own words. `detail` is that sentence, and only the monitor writes it — its
 * arguments are each source's declared probe, never a caller's, so the
 * column holds nothing a person sent.
 *
 * The page asks for each source's latest checks, newest first, so the
 * partial index holds only the monitor's rows in that order: 144 a day per
 * source, against every real call the other indexes carry.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`alter table tool_calls add column detail text`;
  await sql`
    create index tool_calls_probe_latest
    on tool_calls (source, called_at desc)
    where transport = 'probe'`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop index if exists tool_calls_probe_latest`;
  await sql`alter table tool_calls drop column if exists detail`;
}
