import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { connectForScripts, type Sql } from "./client";
import { loadLocalEnv } from "./env";

/**
 * Runs the seeders under `seeders/` in name order, or just the one named:
 *
 *   pnpm db:seed             every seeder
 *   pnpm db:seed countries   one of them
 *
 * Seeders are written to be run again: each upserts, so seeding twice leaves
 * the same rows as seeding once. Each runs in its own transaction.
 */

const SEEDERS_DIR = resolve(import.meta.dirname, "seeders");

/** Returns a one-line summary of what it did, for the log. */
type Seeder = { seed: (sql: Sql) => Promise<string> };

async function main(only: string | undefined): Promise<void> {
  const files = readdirSync(SEEDERS_DIR)
    .filter((file) => file.endsWith(".ts"))
    .sort();
  const chosen = only === undefined ? files : files.filter((file) => file === `${only}.ts`);

  if (chosen.length === 0) {
    const available = files.map((file) => file.slice(0, -".ts".length)).join(", ");
    throw new Error(only === undefined ? "No seeders found." : `No seeder called "${only}". Available: ${available}`);
  }

  loadLocalEnv();
  const sql = connectForScripts();
  try {
    for (const file of chosen) {
      const loaded = (await import(pathToFileURL(resolve(SEEDERS_DIR, file)).href)) as Partial<Seeder>;
      const seeder = loaded.seed;
      if (typeof seeder !== "function") throw new Error(`${file} must export seed().`);

      // One transaction per seeder, so a seeder that fails half-way leaves nothing.
      const startedAt = Date.now();
      const summary = await sql.begin((tx) => seeder(tx));
      console.log(`Seeded       ${file.slice(0, -".ts".length)} — ${summary} (${Date.now() - startedAt}ms)`);
    }
  } finally {
    await sql.end();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
