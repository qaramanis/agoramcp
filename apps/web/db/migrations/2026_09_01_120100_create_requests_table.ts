import type { Sql } from "../client";

/**
 * One row per request. There are no accounts, so `requester_hash` — a salted
 * SHA-256 of the client's address and user agent, see `db/requester.ts` — is
 * what "the same person" means, and the unique pair is what makes a country
 * count once per person however often the button is pressed. The pair's
 * index leads with the country, so it serves the per-country count too.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`
    create table requests (
      id             bigserial   primary key,
      country_code   char(2)     not null references countries (code),
      requester_hash char(64)    not null,
      created_at     timestamptz not null default now(),
      unique (country_code, requester_hash)
    )`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop table if exists requests`;
}
