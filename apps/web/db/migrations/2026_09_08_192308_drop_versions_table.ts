import type { Sql } from "../client";

/**
 * Drops the version log. It recorded `v.{major}.{countries}.{commits}` each
 * time `pnpm db:version` found the count had moved, for a footer that read
 * it once a minute. The footer and the changelog page now read the top entry
 * of `data/changelog.ts`, written by hand and committed with the change it
 * describes, so nothing reads this table and the script that wrote it is
 * gone. `down` puts it back as it was made, so a rollback loses only rows.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`drop table if exists versions`;
}

export async function down(sql: Sql): Promise<void> {
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
