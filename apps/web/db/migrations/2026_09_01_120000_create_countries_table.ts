import type { Sql } from "../client";

/**
 * Every country the request form can ask for, keyed by ISO 3166-1 alpha-2 —
 * the value the form already submits, so nothing stands between a request
 * and its row. `supported` is what the page reads: a country with a source
 * mounted. The seeder sets it and nothing unsets it by accident.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`
    create table countries (
      code       char(2)     primary key,
      name       text        not null,
      supported  boolean     not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop table if exists countries`;
}
