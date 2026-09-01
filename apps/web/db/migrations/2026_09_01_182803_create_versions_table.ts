import type { Sql } from "../client";

/**
 * The version log: one row each time `pnpm db:version` finds the version has
 * moved, newest last. The parts are stored and the string is derived from
 * them by the table itself — `v.{major}.{countries}.{commits}` — so the row
 * and the footer can never disagree about what a version says. `countries`
 * is how many were marked supported and `commits` how many the repository
 * held when the row was written; `commit_sha` is the commit that count was
 * taken at. The casts keep the expression immutable, which a generated
 * column has to be.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`
    create table versions (
      id         serial      primary key,
      major      integer     not null,
      countries  integer     not null,
      commits    integer     not null,
      commit_sha char(40)    not null,
      version    text        not null generated always as
                   ('v.' || major::text || '.' || countries::text || '.' || commits::text) stored,
      created_at timestamptz not null default now()
    )`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop table if exists versions`;
}
