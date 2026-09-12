import { loadHistory, type DayRow } from "@/db/tool-calls";
import { allPath } from "./directory";
import { greeklish } from "./greeklish";
import {
  fetchRegistry,
  MCP_SERVER_URL,
  type Registry,
  type RegistrySource,
  type RegistryTool,
} from "./registry";

/**
 * The status check: one real call per mounted registry, made the way anyone
 * else would make it — a plain HTTP request to the public API, with the
 * arguments the tool itself ships as its example.
 *
 * It deliberately goes through the front door rather than probing each
 * registry directly. What a reader wants to know is whether a question they
 * ask today comes back answered, and that is the whole path: our server, the
 * source's adapter, the registry behind it. A probe that skipped the first two
 * would be measuring something nobody uses.
 *
 * The same check is made twice over: by the page, for the verdict at the top,
 * and by the cron every ten minutes, whose results are kept as rows beside
 * every real call the server answers. The history under each registry is
 * those rows, counted by the day.
 */

/** Answering, answering but slowly, or not answering. */
export type Health = "ok" | "slow" | "down";

export type SourceStatus = {
  id: string;
  country: string;
  /** Transliterated, as the site writes it. */
  name: string;
  /** The source's page in the catalogue. */
  href: string;
  /** The tool the check called, so the result is reproducible. */
  tool: string;
  /** The address it called, without the host. */
  path: string;
  health: Health;
  /** Round trip in milliseconds, as measured from here. */
  ms: number;
  /**
   * The API's own code for what went wrong, or `timeout` / `unreachable`
   * when our own server did not answer. Null when it answered.
   */
  code: string | null;
  /** What went wrong, when something did. */
  detail: string | null;
};

/** The checks, just made. */
export type Live = {
  sources: SourceStatus[];
  /** Why there is nothing: our own server did not answer at all. */
  unavailable: string | null;
};

export type Status = Live & {
  /** When the checks ran — the render, since nothing here is cached. */
  checkedAt: Date;
  /** The last `HISTORY_DAYS` days of each source, by registry key (`gr/vies`). */
  history: Record<string, SourceHistory>;
  /** Why the history is missing, when it is missing for a reason worth showing. */
  historyUnavailable: string | null;
};

/** Past this, a call is reported as slow rather than as an answer. */
export const SLOW_MS = 3_000;

/** Past this, it is reported as no answer at all. */
export const TIMEOUT_MS = 10_000;

/** How far back the history goes, and how long a row is kept. */
export const HISTORY_DAYS = 90;

/**
 * Marks a check as ours to the server, which logs it like any call and marks
 * it as a probe — and does not record it, because the cron writes the row
 * itself. The page's own checks send it too: they are looks, not questions.
 */
export const PROBE_HEADER = "x-agoramcp-probe";

/**
 * The tool each source is checked with: a search where the source has one.
 *
 * Two reasons for preferring a search. It exercises the registry's own index
 * rather than one cached record, and it is where each source sets its shortest
 * cache lifetime — so a check is answering for roughly the last few minutes
 * rather than for whenever some record was first fetched. A source with
 * nothing to search gets its cheapest list instead; a lookup by id would send
 * a real identifier upstream on every page view.
 *
 * A source not named here is checked with its first tool, so a new registry
 * appears on this page by being mounted rather than by being added to a list.
 */
const PROBE_TOOLS: Record<string, string> = {
  athens: "search_datasets",
  datagov: "search_datasets",
  diavgeia: "search_decisions",
  kimdis: "search_contracts",
  mitos: "search_procedures",
  vies: "list_member_states",
};

export async function loadStatus(): Promise<Status> {
  // Side by side: the checks and the history read have nothing to say to each other.
  const [live, history] = await Promise.all([probeAll(), loadHistory(HISTORY_DAYS, SLOW_MS)]);

  return {
    ...live,
    checkedAt: new Date(),
    history: buildHistory(history.rows, live.sources),
    historyUnavailable: history.unavailable,
  };
}

/**
 * One call per mounted registry, in parallel: five sequential round trips
 * would make the caller's own latency the sum of the registries' rather than
 * the slowest of them. What the page's verdict and the cron's rows are both
 * made of.
 */
export async function probeAll(): Promise<Live> {
  const result = await fetchRegistry();
  if (result.registry === null) {
    return { sources: [], unavailable: result.unavailable };
  }

  const sources = await Promise.all(bundled(result.registry).map(check));
  sources.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  return { sources, unavailable: null };
}

/**
 * The sources a country actually bundles, the way the catalogue reads them:
 * the bundle is the server's own statement of what it serves, and a source
 * kept off it is not something a reader can call.
 */
function bundled(registry: Registry): RegistrySource[] {
  const byKey = new Map((registry.sources ?? []).map((source) => [source.key, source]));
  return (registry.countries ?? []).flatMap((bundle) =>
    bundle.sources.flatMap((entry) => {
      const source = byKey.get(`${bundle.country}/${entry.id}`);
      return source ? [source] : [];
    }),
  );
}

async function check(source: RegistrySource): Promise<SourceStatus> {
  const tool = probeTool(source);
  const base = {
    id: source.id,
    country: source.country,
    name: greeklish(source.name),
    href: allPath(source.country, source.id),
    tool: tool?.name ?? "",
  };

  // A source with no tools cannot be asked anything, so there is nothing to
  // report about it either way.
  if (!tool) {
    return {
      ...base,
      path: source.api,
      health: "down",
      ms: 0,
      code: "no_tools",
      detail: "This source declares no tools.",
    };
  }

  const query = new URLSearchParams(
    Object.entries(tool.example ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString();
  const path = `${source.api}/${tool.name}`;
  const started = Date.now();

  try {
    const response = await fetch(`${MCP_SERVER_URL}${path}${query ? `?${query}` : ""}`, {
      headers: { accept: "application/json", [PROBE_HEADER]: "1" },
      // Never cached here: a status page that reads a cached check is
      // reporting the past while dating it now.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;

    if (!response.ok) return { ...base, path, health: "down", ms, ...(await reason(response)) };
    return { ...base, path, health: ms > SLOW_MS ? "slow" : "ok", ms, code: null, detail: null };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      ...base,
      path,
      health: "down",
      ms: Date.now() - started,
      code: timedOut ? "timeout" : "unreachable",
      detail: timedOut
        ? `No answer within ${TIMEOUT_MS / 1_000} seconds.`
        : "agoramcp could not be reached.",
    };
  }
}

/** The named tool, or the source's first — see `PROBE_TOOLS`. */
function probeTool(source: RegistrySource): RegistryTool | undefined {
  const named = PROBE_TOOLS[source.id];
  return source.tools.find((tool) => tool.name === named) ?? source.tools[0];
}

/**
 * Why the call failed, in the API's own words. Every error the server sends
 * carries a `code` and a message written for a person, so the page repeats
 * those rather than paraphrasing a status number — and the code is kept on
 * its own, since a row in the history is counted by it.
 */
async function reason(response: Response): Promise<{ code: string; detail: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    const code = body.error?.code;
    const message = body.error?.message?.split("\n")[0]?.trim();
    if (code && message) return { code, detail: `${code} — ${message}` };
    if (code) return { code, detail: code };
  } catch {
    // Not JSON, or nothing at all. The status is still worth reporting.
  }
  return { code: `http_${response.status}`, detail: `The API answered ${response.status}.` };
}

export const HEALTH_LABELS: Record<Health, string> = {
  ok: "Answering",
  slow: "Answering slowly",
  down: "Not answering",
};

/** One line over the list: what the checks add up to. */
export function summarise(sources: SourceStatus[]): string {
  const down = sources.filter((source) => source.health === "down").length;
  const slow = sources.filter((source) => source.health === "slow").length;

  if (sources.length === 0) return "Nothing is mounted to check.";
  if (down === sources.length) return "No registry answered.";
  if (down > 0) {
    return `${down} of ${sources.length} ${down === 1 ? "registry is" : "registries are"} not answering.`;
  }
  if (slow > 0) {
    return `Every registry answered, ${slow === 1 ? "one" : slow} slower than usual.`;
  }
  return sources.length === 1
    ? "The registry answered."
    : `All ${sources.length} registries answered.`;
}

/** "14:32 UTC on 7 September 2026" — no locale, no relative time to go stale. */
export function formatChecked(at: Date): string {
  const time = at.toISOString().slice(11, 16);
  const day = at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${time} UTC on ${day}`;
}

/*
 * The history: the rows under each registry, shaped for a strip of days.
 */

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
 * The share of a day's calls not answered past which the day is degraded,
 * and past which it is an outage. One failure among the probe's own hundred
 * and forty a day is a blip; one in four is not.
 */
export const DEGRADED_SHARE = 0.01;
export const OUTAGE_SHARE = 0.25;

/**
 * Every live source's window, filled day by day from the rows: a source with
 * no rows still gets its strip, all `none`, rather than no strip. Keyed the
 * way the rows are — the registry key — because that is what the server
 * writes and what survives a rename.
 */
export function buildHistory(
  rows: DayRow[],
  sources: SourceStatus[],
  now: Date = new Date(),
): Record<string, SourceHistory> {
  const dates = lastDays(HISTORY_DAYS, now);

  const byKey = new Map<string, Map<string, DayRow>>();
  for (const row of rows) {
    const own = byKey.get(row.source) ?? new Map<string, DayRow>();
    own.set(row.day, row);
    byKey.set(row.source, own);
  }

  const history: Record<string, SourceHistory> = {};
  for (const source of sources) {
    const key = `${source.country}/${source.id}`;
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
