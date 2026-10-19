import type { Sql } from "../client";

/**
 * When the status monitor's newest round began. The cron starts a round once
 * a day, and the status page starts one whenever it is opened and the newest
 * is older than a few minutes; the round itself takes seconds, so two
 * readers a moment apart would otherwise start one each. A round is claimed
 * by moving `round_at` forward only if it is old enough, in one statement,
 * so of any number of claims at once exactly one wins. One row, never more:
 * the claim makes it on first use.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`
    create table status_monitor (
      id       smallint    primary key check (id = 1),
      round_at timestamptz not null
    )`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop table if exists status_monitor`;
}
