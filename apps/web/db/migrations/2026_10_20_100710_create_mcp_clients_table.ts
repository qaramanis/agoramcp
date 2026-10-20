import type { Sql } from "../client";

/**
 * Which MCP clients connect, counted per day. A client names itself once, in
 * `initialize`, and the server is stateless, so a later `tools/call` carries
 * no name: what can be counted is connections, not calls. One row per day,
 * name and version, and each `initialize` adds one to `connections`. The
 * server writes the rows (`apps/server/src/record.ts`). Nothing deletes
 * them: a row a day per client is small.
 */
export async function up(sql: Sql): Promise<void> {
  await sql`
    create table mcp_clients (
      day         date    not null,
      name        text    not null,
      version     text    not null,
      connections integer not null,
      primary key (day, name, version)
    )`;
}

export async function down(sql: Sql): Promise<void> {
  await sql`drop table if exists mcp_clients`;
}
