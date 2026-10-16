/**
 * What the status page says, worked out from the record — pure, so every
 * rule here is tested without a database or a server.
 *
 * The page calls nothing. Every call the server answers is a row in
 * `tool_calls`, and once a day a monitor (the cron at `/api/cron/status`)
 * asks every registry one question of its own and writes the outcome as a
 * `probe` row beside them. A registry is shown as the newest of those rows
 * found it, whoever asked: a call that failed a minute ago is the present,
 * and so is the monitor's check on a day nobody else asked. This module
 * turns the rows into the verdict at the top of the page, a state per
 * registry, and the strip of its last ninety days.
 *
 * Kept free of `@/` imports and of Next, so `tsx --test` can load it.
 */

/** Answering, answering but slowly, not answering — or not asked recently enough to say. */
export type Health = "ok" | "slow" | "down" | "unknown";

/** Past this, the monitor's check is reported as slow rather than as an answer. */
export const SLOW_MS = 3_000;

/** Past this, the monitor abandons a check and records no answer. */
export const TIMEOUT_MS = 10_000;

/** How far back the history goes, and how long a row is kept. */
export const HISTORY_DAYS = 90;

/**
 * The hour the monitor runs, UTC (`vercel.json`, `0 4 * * *`). Vercel's
 * free plan allows one run a day, and starts it some time within that hour.
 */
export const CHECK_HOUR_UTC = 4;

/**
 * Past this with nothing asked, what a registry last did is no longer
 * reported as the present: a day between the monitor's runs, the hour
 * Vercel may start each one in, and an hour's slack.
 */
export const STALE_AFTER_HOURS = 26;

/** How far back the page reads the record, to find each registry's newest answer and since when it has held. */
export const EVIDENCE_DAYS = 7;

/**
 * The share of a day's calls not answered past which the day is degraded,
 * and past which it is an outage. One failure in a hundred calls is a blip;
 * one in four is not.
 */
export const DEGRADED_SHARE = 0.01;
export const OUTAGE_SHARE = 0.25;

const hourOfDay = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;

/** When the monitor runs, as the page says it: "between 04:00 and 05:00 UTC". */
export const CHECK_WINDOW = `between ${hourOfDay(CHECK_HOUR_UTC)} and ${hourOfDay(CHECK_HOUR_UTC + 1)} UTC`;

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/** What the record says about one registry. Mirrors `EvidenceRecord` in `db/tool-calls.ts`. */
export type Evidence = {
  source: string;
  /** The newest call or check. */
  latest: {
    /** ISO 8601. */
    at: string;
    /** The row's transport: `probe` for the monitor, `api` or `mcp` for a real call. */
    via: string;
    tool: string;
    /** Answered, or failed for a reason that was the caller's own. */
    answered: boolean;
    code: string | null;
    detail: string | null;
    durationMs: number;
  };
  /** The unbroken run of the same outcome that ends in the latest. */
  run: { since: string; count: number; reachesBack: boolean };
  /** Calls and checks in the last 24 hours. */
  lastDay: { total: number; failed: number };
  /** The monitor's newest check, if it made one in the window. */
  probe: { at: string; tool: string; ok: boolean; code: string | null; detail: string | null; durationMs: number } | null;
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

/** Who asked: the monitor's daily check, or a real call through the API or over MCP. */
export type AskedBy = "check" | "api" | "mcp";

export type SourceStatus = Mounted & {
  health: Health;
  /** The newest call or check, ISO; null with none in the window. */
  askedAt: string | null;
  askedBy: AskedBy | null;
  /** The API's own code for what went wrong at the newest call or check. */
  code: string | null;
  /** What went wrong, or why the state is unknown. */
  detail: string | null;
  /**
   * When the present state began: the first of the unbroken run of calls
   * and checks that ends in the newest. Null with none in the window.
   */
  since: string | null;
  /** Whether that run reaches back past what the page reads, so `since` is a lower bound. */
  sinceOrEarlier: boolean;
  /** Calls and checks in that run. */
  run: number;
  /** Calls and checks in the last 24 hours, and how many of them were not answered. */
  lastDay: { total: number; failed: number };
  /**
   * The monitor's newest check, kept apart from the rest: it is the one
   * question asked the same way every day, so the one whose time compares
   * from day to day, and the one a reader can repeat.
   */
  check: { at: string; tool: string; ok: boolean; ms: number } | null;
};

/**
 * The line at the top. `none`: nothing is recorded; `stale`: nothing has
 * been asked of any registry recently; `server`: our own server did not
 * answer; otherwise how the registries answered when last asked.
 */
export type VerdictState = "ok" | "degraded" | "down" | "server" | "stale" | "none";

export type Verdict = {
  state: VerdictState;
  summary: string;
  /** The newest call or check of any registry, ISO. */
  askedAt: string | null;
  /** The monitor's newest check, ISO; null with none in the window. */
  checkedAt: string | null;
  /** The monitor has missed its run: no check for `STALE_AFTER_HOURS`. */
  monitorLate: boolean;
};

export const HEALTH_LABELS: Record<Health, string> = {
  ok: "Answering",
  slow: "Answering slowly",
  down: "Not answering",
  unknown: "Not asked recently",
};

/* -------------------------------------------------------------------------- */
/* Per registry                                                               */
/* -------------------------------------------------------------------------- */

const hoursSince = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / 3_600_000;

/**
 * The newest call or check as a health. Only the monitor's check can be
 * slow: it asks the same small question every day, while a real call's time
 * is as long as the question it asked — a PDF read is not a slow registry.
 */
export function healthOf(latest: Evidence["latest"]): Exclude<Health, "unknown"> {
  if (!latest.answered) return "down";
  return latest.via === "probe" && latest.durationMs > SLOW_MS ? "slow" : "ok";
}

/**
 * The server records a failed call's code and nothing else, since its
 * message may repeat the arguments; these say what each code means. The
 * monitor writes the API's own sentence for its checks.
 */
const CODE_TEXT: Record<string, string> = {
  upstream_error: "The registry answered with an error.",
  upstream_timeout: "The registry did not answer in time.",
  upstream_unavailable: "The registry said it is unavailable.",
  rate_limited: "The registry turned the call away as one too many.",
  missing_credentials: "agoramcp is missing the credentials this registry needs.",
  internal: "An unexpected failure inside agoramcp.",
};

function failureOf(latest: Evidence["latest"]): string {
  if (latest.detail) return latest.detail;
  if (!latest.code) return "No answer.";
  return `${latest.code}: ${CODE_TEXT[latest.code] ?? "No answer."}`;
}

const askedByOf = (via: string): AskedBy => (via === "probe" ? "check" : via === "mcp" ? "mcp" : "api");

/**
 * Each mounted registry as the page shows it: the newest call or check,
 * how long its outcome has held, the last day, and the monitor's own check.
 * A registry with nothing in the window, or nothing recent, is `unknown`
 * and says why — what it did two days ago is not the present.
 */
export function composeSources(
  mounted: readonly Mounted[],
  evidence: readonly Evidence[],
  now: Date = new Date(),
): SourceStatus[] {
  const bySource = new Map(evidence.map((entry) => [entry.source, entry]));

  return mounted
    .map((source): SourceStatus => {
      const own = bySource.get(source.key);

      if (!own) {
        return {
          ...source,
          health: "unknown",
          askedAt: null,
          askedBy: null,
          code: null,
          detail: `Not asked in the last ${EVIDENCE_DAYS} days. The monitor asks every registry once a day, ${CHECK_WINDOW}.`,
          since: null,
          sinceOrEarlier: false,
          run: 0,
          lastDay: { total: 0, failed: 0 },
          check: null,
        };
      }

      const { latest, run, probe } = own;
      const stale = hoursSince(latest.at, now) > STALE_AFTER_HOURS;
      const health = stale ? "unknown" : healthOf(latest);

      return {
        ...source,
        health,
        askedAt: latest.at,
        askedBy: askedByOf(latest.via),
        code: latest.code,
        detail: stale
          ? `Not asked since ${formatChecked(latest.at)}, when it was ${HEALTH_LABELS[healthOf(latest)].toLowerCase()}.`
          : health === "down"
            ? failureOf(latest)
            : null,
        since: run.since,
        sinceOrEarlier: run.reachesBack,
        run: run.count,
        lastDay: own.lastDay,
        check: probe ? { at: probe.at, tool: probe.tool, ok: probe.ok, ms: probe.durationMs } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/* -------------------------------------------------------------------------- */
/* The verdict                                                                */
/* -------------------------------------------------------------------------- */

/** One line over the list: what the registries' newest answers add up to. */
export function summarise(sources: readonly SourceStatus[]): string {
  const asked = sources.filter((source) => source.health !== "unknown");
  const down = asked.filter((source) => source.health === "down").length;
  const slow = asked.filter((source) => source.health === "slow").length;
  const unknown = sources.length - asked.length;
  const tail = unknown > 0 ? ` ${unknown} ${unknown === 1 ? "has" : "have"} not been asked recently.` : "";

  if (sources.length === 0) return "Nothing is mounted to check.";
  if (asked.length === 0) return "No registry has been asked recently.";
  if (down === asked.length) return `No registry answered when last asked.${tail}`;
  if (down > 0) {
    return `${down} of ${asked.length} registries did not answer when last asked.${tail}`;
  }
  if (slow > 0) {
    return `Every registry answered when last asked, ${slow === 1 ? "one" : slow} slower than usual.${tail}`;
  }
  return asked.length === 1
    ? `The registry answered when last asked.${tail}`
    : `All ${asked.length} registries answered when last asked.${tail}`;
}

/** The latest of some ISO times, or null with none. */
function newest(times: readonly string[]): string | null {
  return times.reduce<string | null>((latest, at) => (latest === null || at > latest ? at : latest), null);
}

/**
 * The verdict, from every registry's newest answer. When each one that has
 * been asked recently last found our own server unreachable, that is the
 * news, and nothing is said about the registries behind it: a real call
 * recorded since would be the server answering, and would have replaced it.
 */
export function composeVerdict(sources: readonly SourceStatus[], now: Date = new Date()): Verdict {
  const askedAt = newest(sources.flatMap((source) => (source.askedAt ? [source.askedAt] : [])));
  const checkedAt = newest(sources.flatMap((source) => (source.check ? [source.check.at] : [])));
  const monitorLate = checkedAt === null || hoursSince(checkedAt, now) > STALE_AFTER_HOURS;
  const times = { askedAt, checkedAt, monitorLate };

  if (askedAt === null) return { state: "none", summary: "Nothing has been recorded yet.", ...times };

  const asked = sources.filter((source) => source.health !== "unknown");
  if (asked.length === 0) {
    return { state: "stale", summary: `Nothing has been asked since ${formatChecked(askedAt)}.`, ...times };
  }
  if (asked.every((source) => source.code === "unreachable")) {
    return { state: "server", summary: "agoramcp is not answering.", ...times };
  }

  const down = asked.filter((source) => source.health === "down").length;
  const state: VerdictState = down === asked.length ? "down" : down > 0 ? "degraded" : "ok";
  return { state, summary: summarise(sources), ...times };
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
