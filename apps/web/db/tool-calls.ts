import { db } from "./client";

/**
 * The status history's table: every call the server answered and every probe
 * the cron made, as `tool_calls` rows. The server inserts its own rows
 * (`apps/server/src/record.ts`); this module is the web app's side — the
 * probe's inserts, the prune, and the reads the status page makes.
 */

/**
 * Codes that are the caller's own mistake rather than the registry failing:
 * the registry answered, it just had nothing for that question. Counted as
 * calls, never as failures.
 */
export const CALLERS_OWN = ["not_found", "invalid_input"] as const;

/** One probe result as the cron writes it. */
export type ProbeRow = {
  /** The registry key: `gr/vies`. */
  source: string;
  tool: string;
  ok: boolean;
  /** The API's error code, `unreachable` / `timeout` when our own server did not answer, or `empty` when it answered with nothing. */
  code: string | null;
  /** Why, in the API's own words, when it did not answer; null when it did. */
  detail: string | null;
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
    detail: row.detail,
    duration_ms: row.durationMs,
  }));
  await sql`insert into tool_calls ${sql(values, "source", "tool", "transport", "ok", "code", "detail", "duration_ms")}`;
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

/* -------------------------------------------------------------------------- */
/* The monitor's latest checks                                                */
/* -------------------------------------------------------------------------- */

/**
 * One of the monitor's checks, as the page reads it back. Times are ISO
 * strings rather than dates: the page caches what it reads, and a cache
 * keeps JSON.
 */
export type ProbeRecord = {
  source: string;
  tool: string;
  calledAt: string;
  ok: boolean;
  code: string | null;
  detail: string | null;
  durationMs: number;
};

/**
 * Every check of the last `hours`, newest first within each source: enough
 * to say what each registry is doing now and since when. A day of them is
 * 144 rows a source, read through the partial index the monitor's rows have
 * to themselves.
 */
export async function listRecentProbes(hours: number): Promise<ProbeRecord[]> {
  const sql = db();
  const rows = await sql<
    { source: string; tool: string; called_at: Date; ok: boolean; code: string | null; detail: string | null; duration_ms: number }[]
  >`
    select source, tool, called_at, ok, code, detail, duration_ms
    from tool_calls
    where transport = 'probe' and called_at >= now() - make_interval(hours => ${hours})
    order by source, called_at desc`;
  return rows.map((row) => ({
    source: row.source,
    tool: row.tool,
    calledAt: row.called_at.toISOString(),
    ok: row.ok,
    code: row.code,
    detail: row.detail,
    durationMs: row.duration_ms,
  }));
}

/** Real calls a source has answered and failed since its latest check. */
export type TrafficRecord = {
  source: string;
  total: number;
  failed: number;
  lastAnsweredAt: string | null;
  lastFailedAt: string | null;
};

/**
 * What everyone else's calls say since each source's latest check: the
 * monitor asks once every ten minutes, and the calls in between are free
 * evidence. Only calls the server recorded — MCP and the API — and only after
 * the check, so the two never describe the same moment. A caller's own
 * mistake counts as answered, as it does in the history.
 */
export async function listTrafficSinceProbes(hours: number): Promise<TrafficRecord[]> {
  const sql = db();
  const own = [...CALLERS_OWN];
  const rows = await sql<
    { source: string; total: number; failed: number; last_answered: Date | null; last_failed: Date | null }[]
  >`
    with latest as (
      select source, max(called_at) as checked_at
      from tool_calls
      where transport = 'probe' and called_at >= now() - make_interval(hours => ${hours})
      group by source
    )
    select
      calls.source,
      count(*)::int as total,
      count(*) filter (where not calls.ok and (calls.code is null or calls.code <> all(${own})))::int as failed,
      max(calls.called_at) filter (where calls.ok or calls.code = any(${own})) as last_answered,
      max(calls.called_at) filter (where not calls.ok and (calls.code is null or calls.code <> all(${own}))) as last_failed
    from tool_calls as calls
    join latest on latest.source = calls.source and calls.called_at > latest.checked_at
    where calls.transport <> 'probe'
    group by calls.source`;
  return rows.map((row) => ({
    source: row.source,
    total: row.total,
    failed: row.failed,
    lastAnsweredAt: row.last_answered?.toISOString() ?? null,
    lastFailedAt: row.last_failed?.toISOString() ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* The 90-day history                                                         */
/* -------------------------------------------------------------------------- */

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
  const own = [...CALLERS_OWN];
  return sql<DayRow[]>`
    select
      source,
      to_char(called_at at time zone 'utc', 'YYYY-MM-DD') as day,
      count(*)::int as total,
      count(*) filter (
        where not ok and (code is null or code <> all(${own}))
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
