import type { Sql } from "../client";

/**
 * A call the server answered wholly from its own cache never reached the
 * registry, so it says nothing about whether the registry is answering: a
 * registry that went down an hour ago still "answers" every question asked
 * of it within its TTL. `cached` marks those rows. The server still writes
 * them, since the table keeps the raw outcome; the status page leaves them
 * out of what it reads. Every row before this, and every probe — which reads
 * nothing from the cache — is `false`.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`alter table tool_calls add column cached boolean not null default false`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`alter table tool_calls drop column if exists cached`;
}
