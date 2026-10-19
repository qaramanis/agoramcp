import { db } from "./client";

/**
 * The status history's table: every call the server answered and every probe
 * the monitor made, as `tool_calls` rows. The server inserts its own rows
 * (`apps/server/src/record.ts`); this module is the web app's side — the
 * probe's inserts, the claim on a round, the prune, and the reads the status
 * page makes.
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

/**
 * Claims the next round of the monitor's checks: true when this caller
 * should make it. Only one claim wins while the newest round is under
 * `everyMinutes` old — the row lock makes a second claim at the same moment
 * wait, then find the round already moved forward (`status_monitor`). The
 * cron claims with 0, so its daily round always runs, and a reader who
 * opens the page just after it does not start another.
 */
export async function claimRound(everyMinutes: number): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    insert into status_monitor (id, round_at) values (1, now())
    on conflict (id) do update set round_at = excluded.round_at
    where status_monitor.round_at <= now() - make_interval(mins => ${everyMinutes})
    returning round_at`;
  return rows.length > 0;
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
/* The evidence                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What the record says about one registry: the newest call or check, the
 * unbroken run of the same outcome behind it, the last day, and the newest
 * of the monitor's own checks. Times are ISO strings rather than dates: the
 * page caches what it reads, and a cache keeps JSON.
 */
export type EvidenceRecord = {
  source: string;
  latest: {
    at: string;
    /** `probe` for the monitor's check, `api` or `mcp` for a real call. */
    via: string;
    tool: string;
    /** Answered, or failed for a reason that was the caller's own. */
    answered: boolean;
    code: string | null;
    detail: string | null;
    durationMs: number;
  };
  run: {
    /** The first call or check of the run that ends in the latest. */
    since: string;
    count: number;
    /** No opposite outcome in the window: the run began before it. */
    reachesBack: boolean;
  };
  lastDay: { total: number; failed: number };
  probe: { at: string; tool: string; ok: boolean; code: string | null; detail: string | null; durationMs: number } | null;
};

type EvidenceRow = {
  source: string;
  tool: string;
  transport: string;
  called_at: Date;
  answered: boolean;
  code: string | null;
  detail: string | null;
  duration_ms: number;
  run_since: Date;
  run_count: number;
  reaches_back: boolean;
  day_total: number;
  day_failed: number;
  probe_at: Date | null;
  probe_tool: string | null;
  probe_ok: boolean | null;
  probe_code: string | null;
  probe_detail: string | null;
  probe_ms: number | null;
};

/**
 * Every source's evidence over the last `days`, one row each, in one query:
 * real calls and the monitor's checks are read alike, since either one shows
 * whether the registry answered. A call answered wholly from the server's
 * cache is not read at all: the registry was not asked. A caller's own
 * mistake counts as answered, as it does in the history. The run is
 * everything since the last call or check with the other outcome.
 */
export async function listEvidence(days: number): Promise<EvidenceRecord[]> {
  const sql = db();
  const own = [...CALLERS_OWN];
  const rows = await sql<EvidenceRow[]>`
    with evidence as (
      select source, tool, transport, called_at, code, detail, duration_ms,
             (ok or code = any(${own})) as answered
      from tool_calls
      where called_at >= now() - make_interval(days => ${days}) and not cached
    ),
    latest as (
      select distinct on (source) *
      from evidence
      order by source, called_at desc
    ),
    bounds as (
      select source,
             max(called_at) filter (where answered) as last_answered,
             max(called_at) filter (where not answered) as last_failed,
             count(*) filter (where called_at >= now() - interval '24 hours')::int as day_total,
             count(*) filter (where called_at >= now() - interval '24 hours' and not answered)::int as day_failed
      from evidence
      group by source
    ),
    run as (
      select evidence.source, min(evidence.called_at) as since, count(*)::int as count
      from evidence
      join latest using (source)
      join bounds using (source)
      where evidence.answered = latest.answered
        and evidence.called_at > coalesce(
          case when latest.answered then bounds.last_failed else bounds.last_answered end,
          '-infinity'::timestamptz
        )
      group by evidence.source
    ),
    probe as (
      select distinct on (source) source, tool, called_at, ok, code, detail, duration_ms
      from tool_calls
      where transport = 'probe' and called_at >= now() - make_interval(days => ${days})
      order by source, called_at desc
    )
    select
      latest.source, latest.tool, latest.transport, latest.called_at, latest.answered,
      latest.code, latest.detail, latest.duration_ms,
      run.since as run_since, run.count as run_count,
      (case when latest.answered then bounds.last_failed else bounds.last_answered end) is null as reaches_back,
      bounds.day_total, bounds.day_failed,
      probe.called_at as probe_at, probe.tool as probe_tool, probe.ok as probe_ok,
      probe.code as probe_code, probe.detail as probe_detail, probe.duration_ms as probe_ms
    from latest
    join bounds using (source)
    join run using (source)
    left join probe using (source)`;

  return rows.map((row) => ({
    source: row.source,
    latest: {
      at: row.called_at.toISOString(),
      via: row.transport,
      tool: row.tool,
      answered: row.answered,
      code: row.code,
      detail: row.detail,
      durationMs: row.duration_ms,
    },
    run: { since: row.run_since.toISOString(), count: row.run_count, reachesBack: row.reaches_back },
    lastDay: { total: row.day_total, failed: row.day_failed },
    probe:
      row.probe_at === null
        ? null
        : {
            at: row.probe_at.toISOString(),
            tool: row.probe_tool ?? "",
            ok: row.probe_ok ?? false,
            code: row.probe_code,
            detail: row.probe_detail,
            durationMs: row.probe_ms ?? 0,
          },
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
 * answer — so it counts as a call but not as a failure. A call answered
 * wholly from the server's cache never reached the registry, and is left out.
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
    where called_at >= ${since} and not cached
    group by source, day`;
}

/** Midnight UTC at the start of the oldest day in a window of `days` days ending today. */
export function windowStart(days: number, now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)),
  );
}
