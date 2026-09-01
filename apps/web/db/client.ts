import postgres from "postgres";

/** What a query, migration or seeder takes: a connection, or a transaction on one. */
export type Sql = postgres.ISql;

/** The whole client — a pool, with `begin` and `end`. The runners hold one of these. */
export type Client = postgres.Sql;

let app: Client | undefined;

/**
 * The app's connection, made on first use: importing this module asks for
 * nothing, so `next build` can evaluate a page that reaches the database
 * without there being one to reach. Shaped for serverless — a small pool,
 * idle connections let go quickly, and no prepared statements, which Neon's
 * pooled endpoint (PgBouncer in transaction mode) would not keep between
 * calls anyway.
 */
export function db(): Client {
  if (app) return app;
  app = connect(required("DATABASE_URL"), 5);
  return app;
}

/**
 * The scripts' connection: one session held for the run and closed after.
 * Migrations want the direct endpoint rather than the pooler — a DDL
 * transaction has to stay on one server session to be rolled back — so the
 * unpooled URL wins where both are set.
 */
export function connectForScripts(): Client {
  return connect(process.env.DATABASE_URL_UNPOOLED ?? required("DATABASE_URL"), 1, {
    // A notice is worth a line in a script's output — `drop table if exists`
    // on a table that is not there, say — not the object the driver logs.
    onnotice: (notice) => console.log(`Notice       ${notice.message}`),
  });
}

function connect(url: string, max: number, options: ScriptOptions = {}): Client {
  return postgres(url, {
    max,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    ...options,
  });
}

type ScriptOptions = {
  onnotice?: (notice: postgres.Notice) => void;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}
