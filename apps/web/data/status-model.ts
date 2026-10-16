/**
 * What the status page says, worked out from what the monitor recorded —
 * pure, so every rule here is tested without a database or a server.
 *
 * The page calls nothing. A monitor (the cron at `/api/cron/status`) asks
 * every registry one question every ten minutes and writes the outcome as a
 * `probe` row; every real call the server answers is a row beside it. This
 * module turns those rows into the verdict at the top of the page, a state
 * per registry, and the strip of its last ninety days.
 *
 * Kept free of `@/` imports and of Next, so `tsx --test` can load it.
 */

/** Answering, answering but slowly, not answering — or not checked recently enough to say. */
export type Health = "ok" | "slow" | "down" | "unknown";

/** Past this, a check is reported as slow rather than as an answer. */
export const SLOW_MS = 3_000;

/** Past this, the monitor abandons a check and records no answer. */
export const TIMEOUT_MS = 10_000;

/** How far back the history goes, and how long a row is kept. */
export const HISTORY_DAYS = 90;

/** How often the monitor checks (`vercel.json`). */
export const CHECK_EVERY_MINUTES = 10;

/**
 * Past this with no check, what the monitor last saw is no longer reported
 * as the present: two missed runs and some slack for a slow one.
 */
export const STALE_AFTER_MINUTES = 25;

/** How far back the page reads the monitor's checks, to say since when a state has held. */
export const RUN_WINDOW_HOURS = 24;

/**
 * The share of a day's calls not answered past which the day is degraded,
 * and past which it is an outage. One failure among the probe's own hundred
 * and forty a day is a blip; one in four is not.
 */
export const DEGRADED_SHARE = 0.01;
export const OUTAGE_SHARE = 0.25;

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/** One of the monitor's checks. Mirrors `ProbeRecord` in `db/tool-calls.ts`. */
export type Check = {
  source: string;
  tool: string;
  /** ISO 8601. */
  calledAt: string;
  ok: boolean;
  code: string | null;
  detail: string | null;
  durationMs: number;
};

/** Real calls since a source's latest check. Mirrors `TrafficRecord`. */
export type Traffic = {
  source: string;
  total: number;
  failed: number;
  lastAnsweredAt: string | null;
  lastFailedAt: string | null;
};

/** One source's calls on one UTC day. Mirrors `DayRow`. */
export type Day = {
  source: string;
  day: string;
  total: number;
  failed: number;
};

/** A registry the server mounts, as the page names and links it. */
export type Mounted = {
  /** `gr/vies`. */
  key: string;
  id: string;
  country: string;
  name: string;
  href: string;
};

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

export type SourceStatus = Mounted & {
  /** The tool the latest check called, so the result is reproducible. */
  tool: string | null;
  health: Health;
  /** When the latest check ran, ISO; null when it never has. */
  checkedAt: string | null;
  /** The latest check's round trip, as the monitor measured it. */
  ms: number | null;
  /** The API's own code for what went wrong at the latest check. */
  code: string | null;
  /** What went wrong, or why the state is unknown. */
  detail: string | null;
  /**
   * When the present state began: the first of the unbroken run of checks
   * that ends in the latest. Null with no checks.
   */
  since: string | null;
  /** Whether that run reaches back past what the page reads, so `since` is a lower bound. */
  sinceOrEarlier: boolean;
  /** Checks in that run. */
  checks: number;
  /** Real calls since the latest check; null when there were none. */
  traffic: Traffic | null;
};

/**
 * The line at the top. `none`: nothing has ever been checked; `stale`: the
 * monitor has stopped; `server`: our own server did not answer the latest
 * round; otherwise how the registries are doing.
 */
export type VerdictState = "ok" | "degraded" | "down" | "server" | "stale" | "none";

export type Verdict = {
  state: VerdictState;
  summary: string;
  /** When the latest check ran, ISO. */
  checkedAt: string | null;
  /** When the next one is due, ISO. */
  nextCheckBy: string | null;
};

export const HEALTH_LABELS: Record<Health, string> = {
  ok: "Answering",
  slow: "Answering slowly",
  down: "Not answering",
  unknown: "Not checked recently",
};

/* -------------------------------------------------------------------------- */
/* Per registry                                                               */
/* -------------------------------------------------------------------------- */

const minutes = (ms: number) => ms / 60_000;

/** A recorded check as a health: the monitor writes `ok` for anything that answered, slow or not. */
export function healthOf(check: Check): Exclude<Health, "unknown"> {
  if (!check.ok) return "down";
  return check.durationMs > SLOW_MS ? "slow" : "ok";
}

/** Answering, slowly or not, against not answering: the line a run of checks is broken by. */
const answered = (check: Check) => check.ok;

/**
 * Each mounted registry as the page shows it: the latest check, how long
 * the state has held, and what real calls have said since. A registry with
 * no check yet, or none recent, is `unknown` and says why — what the
 * monitor saw an hour ago is not the present.
 */
export function composeSources(
  mounted: readonly Mounted[],
  checks: readonly Check[],
  traffic: readonly Traffic[],
  now: Date = new Date(),
): SourceStatus[] {
  const bySource = new Map<string, Check[]>();
  for (const check of checks) {
    const own = bySource.get(check.source) ?? [];
    own.push(check);
    bySource.set(check.source, own);
  }
  const trafficBySource = new Map(traffic.map((entry) => [entry.source, entry]));
  const windowStart = now.getTime() - RUN_WINDOW_HOURS * 3_600_000;

  return mounted
    .map((source): SourceStatus => {
      const own = (bySource.get(source.key) ?? []).sort((a, b) => b.calledAt.localeCompare(a.calledAt));
      const latest = own[0];

      if (!latest) {
        return {
          ...source,
          tool: null,
          health: "unknown",
          checkedAt: null,
          ms: null,
          code: null,
          detail: `Not checked yet. The monitor asks every registry once every ${CHECK_EVERY_MINUTES} minutes.`,
          since: null,
          sinceOrEarlier: false,
          checks: 0,
          traffic: trafficBySource.get(source.key) ?? null,
        };
      }

      // The unbroken run of answers, or of failures, that ends in the latest.
      let run = 1;
      while (run < own.length && answered(own[run] as Check) === answered(latest)) run += 1;
      const first = own[run - 1] as Check;
      const reachesBack = run === own.length && Date.parse(first.calledAt) - windowStart < 2 * CHECK_EVERY_MINUTES * 60_000;

      const age = minutes(now.getTime() - Date.parse(latest.calledAt));
      const stale = age > STALE_AFTER_MINUTES;
      const health = stale ? "unknown" : healthOf(latest);

      return {
        ...source,
        tool: latest.tool || null,
        health,
        checkedAt: latest.calledAt,
        ms: latest.durationMs,
        code: latest.code,
        detail: stale
          ? `Not checked since ${formatTime(latest.calledAt)}, when it was ${HEALTH_LABELS[healthOf(latest)].toLowerCase()}.`
          : health === "down"
            ? latest.detail ?? latest.code ?? "No answer."
            : null,
        since: first.calledAt,
        sinceOrEarlier: reachesBack,
        checks: run,
        traffic: trafficBySource.get(source.key) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/* -------------------------------------------------------------------------- */
/* The verdict                                                                */
/* -------------------------------------------------------------------------- */

/** One line over the list: what the registries' states add up to. */
export function summarise(sources: readonly SourceStatus[]): string {
  const checked = sources.filter((source) => source.health !== "unknown");
  const down = checked.filter((source) => source.health === "down").length;
  const slow = checked.filter((source) => source.health === "slow").length;
  const unknown = sources.length - checked.length;
  const tail = unknown > 0 ? ` ${unknown} ${unknown === 1 ? "has" : "have"} not been checked recently.` : "";

  if (sources.length === 0) return "Nothing is mounted to check.";
  if (checked.length === 0) return "No registry has been checked recently.";
  if (down === checked.length) return `No registry answered.${tail}`;
  if (down > 0) {
    return `${down} of ${checked.length} registries ${down === 1 ? "is" : "are"} not answering.${tail}`;
  }
  if (slow > 0) {
    return `Every registry answered, ${slow === 1 ? "one" : slow} slower than usual.${tail}`;
  }
  return checked.length === 1 ? `The registry answered.${tail}` : `All ${checked.length} registries answered.${tail}`;
}

/**
 * The verdict, from the newest round of checks. The cron writes a round in
 * one insert, so its rows share one time: when every row of it is our own
 * server unreachable, that is the news, and nothing is said about the
 * registries behind it.
 */
export function composeVerdict(sources: readonly SourceStatus[], checks: readonly Check[], now: Date = new Date()): Verdict {
  if (checks.length === 0) {
    return { state: "none", summary: "No check has been recorded yet.", checkedAt: null, nextCheckBy: null };
  }

  const newest = checks.reduce((latest, check) => (check.calledAt > latest ? check.calledAt : latest), "");
  const next = new Date(Date.parse(newest) + CHECK_EVERY_MINUTES * 60_000).toISOString();

  if (minutes(now.getTime() - Date.parse(newest)) > STALE_AFTER_MINUTES) {
    return {
      state: "stale",
      summary: `The monitor has not checked since ${formatChecked(newest)}.`,
      checkedAt: newest,
      nextCheckBy: null,
    };
  }

  const round = checks.filter((check) => check.calledAt === newest);
  if (round.length > 0 && round.every((check) => check.code === "unreachable")) {
    return { state: "server", summary: "agoramcp is not answering.", checkedAt: newest, nextCheckBy: next };
  }

  const checked = sources.filter((source) => source.health !== "unknown");
  const down = checked.filter((source) => source.health === "down").length;
  const state: VerdictState = checked.length > 0 && down === checked.length ? "down" : down > 0 ? "degraded" : "ok";
  return { state, summary: summarise(sources), checkedAt: newest, nextCheckBy: next };
}

/* -------------------------------------------------------------------------- */
/* Times                                                                      */
/* -------------------------------------------------------------------------- */

/** "14:32 UTC on 7 September 2026" — no locale, no relative time to go stale. */
export function formatChecked(at: string | Date): string {
  const date = typeof at === "string" ? new Date(at) : at;
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${formatTime(date)} on ${day}`;
}

/** "14:32 UTC". */
export function formatTime(at: string | Date): string {
  const date = typeof at === "string" ? new Date(at) : at;
  return `${date.toISOString().slice(11, 16)} UTC`;
}

/* -------------------------------------------------------------------------- */
/* The history                                                                */
/* -------------------------------------------------------------------------- */

/** How a day went — or `none`, when nothing was asked that day. */
export type DayState = "ok" | "degraded" | "outage" | "none";

export type DayHealth = {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  total: number;
  /** Calls the registry did not answer. */
  failed: number;
  state: DayState;
};

export type SourceHistory = {
  /** One per day of the window, oldest first, today last. */
  days: DayHealth[];
  /** The share of the window's calls that were answered, 0 to 1; null with no calls. */
  uptime: number | null;
};

/**
 * Every mounted source's window, filled day by day from the rows: a source
 * with no rows still gets its strip, all `none`, rather than no strip. Keyed
 * the way the rows are — the registry key — because that is what the server
 * writes and what survives a rename.
 */
export function buildHistory(
  rows: readonly Day[],
  keys: readonly string[],
  now: Date = new Date(),
): Record<string, SourceHistory> {
  const dates = lastDays(HISTORY_DAYS, now);

  const byKey = new Map<string, Map<string, Day>>();
  for (const row of rows) {
    const own = byKey.get(row.source) ?? new Map<string, Day>();
    own.set(row.day, row);
    byKey.set(row.source, own);
  }

  const history: Record<string, SourceHistory> = {};
  for (const key of keys) {
    const own = byKey.get(key);
    let total = 0;
    let failed = 0;

    const days = dates.map((date) => {
      const row = own?.get(date);
      const dayTotal = row?.total ?? 0;
      const dayFailed = row?.failed ?? 0;
      total += dayTotal;
      failed += dayFailed;
      return { date, total: dayTotal, failed: dayFailed, state: stateOf(dayTotal, dayFailed) };
    });

    history[key] = { days, uptime: total === 0 ? null : (total - failed) / total };
  }

  return history;
}

function stateOf(total: number, failed: number): DayState {
  if (total === 0) return "none";
  const share = failed / total;
  if (share >= OUTAGE_SHARE) return "outage";
  if (share >= DEGRADED_SHARE) return "degraded";
  return "ok";
}

/** `YYYY-MM-DD` for each of the last `count` UTC days, oldest first, today last. */
function lastDays(count: number, now: Date): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: count }, (_, index) =>
    new Date(today - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}
