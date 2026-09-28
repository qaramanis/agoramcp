import { db } from "./client";

/**
 * The status history's table: every call the server answered and every probe
 * the cron made, as `tool_calls` rows. The server inserts its own rows
 * (`apps/server/src/record.ts`); this module is the web app's side — the
 * probe's inserts, the prune, and the read the status page makes.
 */

/** One probe result as the cron writes it. */
export type ProbeRow = {
  /** The registry key: `gr/vies`. */
  source: string;
  tool: string;
  ok: boolean;
  /** The API's error code, `unreachable` / `timeout` when our own server did not answer, or `empty` when it answered with nothing. */
  code: string | null;
  durationMs: number;
};

export async function recordProbes(rows: ProbeRow[]): Promise<void> {
  if (rows.length === 0) return;
  const sql = db();
  const values = rows.map((row) => ({
    source: row.source,
    tool: row.tool,
    transport: "probe",
    ok: row.ok,
    code: row.code,
    duration_ms: row.durationMs,
  }));
  await sql`insert into tool_calls ${sql(values, "source", "tool", "transport", "ok", "code", "duration_ms")}`;
}

/** Drops rows older than the window the page shows. Returns how many went. */
export async function pruneToolCalls(days: number): Promise<number> {
  const sql = db();
  const result = await sql`
    delete from tool_calls
    where called_at < now() - make_interval(days => ${days})`;
  return result.count;
}

/**
 * The sources with any row in the window — what to write an `unreachable`
 * row for when our server cannot even be asked what it mounts.
 */
export async function knownSources(days: number): Promise<string[]> {
  const sql = db();
  const rows = await sql<{ source: string }[]>`
    select distinct source from tool_calls
    where called_at >= now() - make_interval(days => ${days})`;
  return rows.map((row) => row.source);
}

/** One source's calls on one UTC day, counted. */
export type DayRow = {
  source: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  total: number;
  /** Calls the registry did not answer: not ok, and not the caller's own mistake. */
  failed: number;
  /** Calls answered slower than the page's threshold. */
  slow: number;
};

/**
 * Every source's calls over the last `days` UTC days, one row per source and
 * day. A `not_found` or `invalid_input` is the caller's — the registry did
 * answer — so it counts as a call but not as a failure.
 */
export async function listSourceHistory(days: number, slowMs: number): Promise<DayRow[]> {
  const sql = db();
  const since = windowStart(days);
  return sql<DayRow[]>`
    select
      source,
      to_char(called_at at time zone 'utc', 'YYYY-MM-DD') as day,
      count(*)::int as total,
      count(*) filter (
        where not ok and (code is null or code not in ('not_found', 'invalid_input'))
      )::int as failed,
      count(*) filter (where duration_ms > ${slowMs})::int as slow
    from tool_calls
    where called_at >= ${since}
    group by source, day`;
}

/** Midnight UTC at the start of the oldest day in a window of `days` days ending today. */
export function windowStart(days: number, now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)),
  );
}

export type HistoryResult = {
  rows: DayRow[];
  /** Why there is nothing, when there is nothing for a reason worth showing. */
  unavailable: string | null;
};

/** The page's read: a database that cannot be reached is a sentence, not a crash. */
export async function loadHistory(days: number, slowMs: number): Promise<HistoryResult> {
  try {
    return { rows: await listSourceHistory(days, slowMs), unavailable: null };
  } catch (error) {
    console.error("status: database unavailable", error);
    return { rows: [], unavailable: `The last ${days} days could not be read.` };
  }
}
