import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { connectForScripts, lockForScript, scriptDatabase, type Client, type Sql } from "./client";
import { loadLocalEnv } from "./env";

/**
 * The migration queue, run the way Laravel runs it. Files under
 * `migrations/` are named `YYYY_MM_DD_HHMMSS_<name>.ts` and export `up` and
 * `down`. A `migrations` table records every one that has run and the batch
 * it ran in: `migrate` runs whatever is pending as one new batch, `rollback`
 * reverses the last batch and deletes its rows, `reset` reverses everything.
 * Each migration runs inside a transaction with its own bookkeeping, so one
 * that fails leaves nothing behind — not even its row.
 *
 * Every run names the database it reached and holds a lock on it, so two
 * runs cannot interleave. `rollback` and `reset` list what they will take
 * down and wait for the database's name to be typed back: `.env.local`
 * points wherever it points, which on the machine these were written on is
 * production. `--force` skips the question.
 *
 *   pnpm db:migrate                      run pending migrations
 *   pnpm db:rollback [--step=N] [--force] reverse the last batch, or the last N
 *   pnpm db:reset [--force]              reverse everything
 *   pnpm db:status                       what has run and what has not
 *   pnpm db:make <name>                  scaffold a new migration file
 */

const MIGRATIONS_DIR = resolve(import.meta.dirname, "migrations");
const FILE_PATTERN = /^\d{4}_\d{2}_\d{2}_\d{6}_[a-z0-9_]+\.ts$/;

type Migration = {
  name: string;
  up: (sql: Sql) => Promise<void>;
  down: (sql: Sql) => Promise<void>;
};

/** A row of the `migrations` table. */
type Ran = { migration: string; batch: number };

async function main(argv: string[]): Promise<void> {
  const [command = "migrate", ...rest] = argv;

  // Needs no database — a file is all it makes.
  if (command === "make") {
    make(rest[0]);
    return;
  }

  loadLocalEnv();
  const database = scriptDatabase();
  const force = rest.includes("--force");
  console.log(`Database     ${database}`);

  const sql = connectForScripts();
  try {
    await lockForScript(sql);
    await ensureTable(sql);

    switch (command) {
      case "migrate":
        await migrate(sql);
        break;
      case "rollback":
        await rollback(sql, stepOption(rest), database, force);
        break;
      case "reset":
        await reset(sql, database, force);
        break;
      case "status":
        await status(sql);
        break;
      default:
        throw new Error(`Unknown command "${command}". Use migrate, rollback, reset, status or make.`);
    }
  } finally {
    await sql.end();
  }
}

/** The bookkeeping table, made on first contact — checked first so the run is not prefaced by a notice. */
async function ensureTable(sql: Sql): Promise<void> {
  const [exists] = await sql<{ found: boolean }[]>`select to_regclass('migrations') is not null as found`;
  if (exists?.found) return;

  await sql`
    create table migrations (
      id        serial       primary key,
      migration varchar(255) not null unique,
      batch     integer      not null
    )`;
}

async function migrate(sql: Client): Promise<void> {
  const files = await loadMigrations();
  const ran = await ranMigrations(sql);
  const done = new Set(ran.map((row) => row.migration));
  const pending = files.filter((migration) => !done.has(migration.name));

  if (pending.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  const batch = Math.max(0, ...ran.map((row) => row.batch)) + 1;
  for (const migration of pending) {
    const startedAt = Date.now();
    await sql.begin(async (tx) => {
      await migration.up(tx);
      await tx`insert into migrations (migration, batch) values (${migration.name}, ${batch})`;
    });
    console.log(`Migrated     ${migration.name} (${Date.now() - startedAt}ms)`);
  }
}

/** The last batch, or with `--step=N` the last N migrations whatever their batch. */
async function rollback(sql: Client, step: number | undefined, database: string, force: boolean): Promise<void> {
  const ran = await ranMigrations(sql);
  const last = ran.at(-1);
  if (!last) {
    console.log("Nothing to roll back.");
    return;
  }

  const targets = step === undefined ? ran.filter((row) => row.batch === last.batch) : ran.slice(-step);
  await confirmDown(sql, targets, database, force);
  await runDown(sql, targets.reverse());
}

async function reset(sql: Client, database: string, force: boolean): Promise<void> {
  const ran = await ranMigrations(sql);
  if (ran.length === 0) {
    console.log("Nothing to roll back.");
    return;
  }
  await confirmDown(sql, ran, database, force);
  await runDown(sql, ran.reverse());
}

/**
 * Says what is about to come off, and goes on only when the database's name
 * is typed back — a `down` usually drops a table, and with it every row.
 * Without a terminal to ask in, only `--force` goes on. The lock is taken
 * again after the answer, which on the same session is a no-op and on a
 * session that dropped while waiting is the check that no one got in.
 */
async function confirmDown(sql: Sql, targets: Ran[], database: string, force: boolean): Promise<void> {
  console.log(`To reverse   ${targets.map((row) => row.migration).join("\n             ")}`);
  if (force) return;

  if (!process.stdin.isTTY) {
    throw new Error("Nothing was reversed: without a terminal to confirm in, pass --force.");
  }
  const name = database.slice(database.indexOf("/") + 1);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await prompt.question(`This drops what those migrations made on ${database}. Type ${name} to go on: `);
  } catch {
    // Ctrl+C or Ctrl+D: no answer is not a yes.
    throw new Error("Nothing was reversed: no answer was given.");
  } finally {
    prompt.close();
  }
  if (answer.trim() !== name) throw new Error("Nothing was reversed: the name did not match.");

  await lockForScript(sql);
}

/** `targets` newest first — the order they have to come off in. */
async function runDown(sql: Client, targets: Ran[]): Promise<void> {
  const files = new Map((await loadMigrations()).map((migration) => [migration.name, migration]));

  for (const row of targets) {
    const migration = files.get(row.migration);
    if (!migration) {
      throw new Error(
        `"${row.migration}" has run but its file is gone — restore it before rolling back.`,
      );
    }

    const startedAt = Date.now();
    await sql.begin(async (tx) => {
      await migration.down(tx);
      await tx`delete from migrations where migration = ${row.migration}`;
    });
    console.log(`Rolled back  ${row.migration} (${Date.now() - startedAt}ms)`);
  }
}

async function status(sql: Sql): Promise<void> {
  const files = await loadMigrations();
  const ran = new Map((await ranMigrations(sql)).map((row) => [row.migration, row.batch]));

  for (const migration of files) {
    const batch = ran.get(migration.name);
    console.log(`${batch === undefined ? "Pending" : `Ran [${batch}]`}`.padEnd(13) + migration.name);
  }
  for (const name of ran.keys()) {
    if (!files.some((migration) => migration.name === name)) {
      console.log("Missing".padEnd(13) + `${name} — ran, but the file is gone`);
    }
  }
}

async function loadMigrations(): Promise<Migration[]> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => FILE_PATTERN.test(file))
    .sort();

  return Promise.all(
    files.map(async (file) => {
      const loaded = (await import(pathToFileURL(resolve(MIGRATIONS_DIR, file)).href)) as Partial<Migration>;
      if (typeof loaded.up !== "function" || typeof loaded.down !== "function") {
        throw new Error(`${file} must export both up() and down().`);
      }
      return { name: file.slice(0, -".ts".length), up: loaded.up, down: loaded.down };
    }),
  );
}

/** Oldest first. */
async function ranMigrations(sql: Sql): Promise<Ran[]> {
  return sql<Ran[]>`select migration, batch from migrations order by id`;
}

function stepOption(args: string[]): number | undefined {
  const inline = args.find((arg) => arg.startsWith("--step="))?.slice("--step=".length);
  const separate = args.indexOf("--step");
  const raw = inline ?? (separate >= 0 ? args[separate + 1] : undefined);
  if (raw === undefined) return undefined;

  const step = Number.parseInt(raw, 10);
  if (!Number.isInteger(step) || step < 1) {
    throw new Error(`--step wants a positive integer, got "${raw}".`);
  }
  return step;
}

function make(name: string | undefined): void {
  if (!name) {
    throw new Error("Usage: pnpm db:make <name> — e.g. pnpm db:make add_note_to_requests");
  }

  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const file = `${stamp(new Date())}_${slug}.ts`;

  // `wx`: never overwrite — two stamps in the same second is a collision, not a rewrite.
  writeFileSync(resolve(MIGRATIONS_DIR, file), TEMPLATE, { flag: "wx" });
  console.log(`Created      db/migrations/${file}`);
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

const TEMPLATE = `import type { Sql } from "../client";

export async function up(sql: Sql): Promise<void> {
  await sql\`\`;
}

export async function down(sql: Sql): Promise<void> {
  await sql\`\`;
}
`;

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
