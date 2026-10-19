import { fallsShort, PROBE_HEADER, type ResolvedProbe } from "@agoramcp/core/probe";
import { PROXY_HEADER } from "@agoramcp/core/requester";
import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import {
  claimRound,
  knownSources,
  listEvidence,
  listSourceHistory,
  recordProbes,
  type DayRow,
  type EvidenceRecord,
  type ProbeRow,
} from "@/db/tool-calls";
import { allPath } from "./directory";
import { greeklish } from "./greeklish";
import { fetchRegistry, MCP_SERVER_URL, type Registry, type RegistrySource } from "./registry";
import {
  ASK_AGAIN_MINUTES,
  buildHistory,
  composeSources,
  composeVerdict,
  EVIDENCE_DAYS,
  HISTORY_DAYS,
  roundDue,
  SLOW_MS,
  TIMEOUT_MS,
  type Mounted,
  type SourceHistory,
  type SourceStatus,
  type Verdict,
} from "./status-model";

export * from "./status-model";

/**
 * The status monitor, and the page that reports it.
 *
 * A round of the monitor makes one real call per mounted registry, the way
 * anyone else would — a plain HTTP request to the public API — and writes
 * what came back as a `probe` row. Each source declares the call (`probe` on
 * its `defineSource`): its cheapest live question, and what a working
 * registry cannot answer without. The request carries the web app's proof,
 * so the server skips its cache and the question reaches the registry itself.
 *
 * Two things start a round. The cron at `/api/cron/status` does once a day,
 * the most Vercel's free plan allows, so a registry nobody looks at is still
 * checked daily. And the page does when it is opened and the newest round is
 * older than `ASK_AGAIN_MINUTES`: the round is claimed in the database, so
 * only one reader starts it, and that reader's page streams the answers in
 * as soon as they are written. A page nobody opens asks nothing.
 *
 * Otherwise the page reads each registry's newest call or check, whoever
 * made it, and the ninety-day history, all from the database, and holds
 * what it read for a minute — or until the next round, which clears it. So
 * a real call that failed is on the page within a minute, and a thousand
 * readers cost one read.
 */

/** The tag the page's read is cached under; the cron clears it after each round. */
export const STATUS_TAG = "status";

/** How long the page holds what it read when no round clears it first. */
const READ_SECONDS = 60;

/* -------------------------------------------------------------------------- */
/* The monitor                                                                */
/* -------------------------------------------------------------------------- */

/** One check, just made. */
export type CheckResult = {
  key: string;
  tool: string;
  health: "ok" | "slow" | "down";
  ms: number;
  code: string | null;
  detail: string | null;
};

export type Round = {
  checks: CheckResult[];
  /** Why there is nothing: our own server did not answer at all. */
  unavailable: string | null;
};

/**
 * One check per mounted registry, in parallel: sequential round trips would
 * make the round as long as the sum of the registries rather than the
 * slowest of them.
 */
export async function checkAll(): Promise<Round> {
  const result = await fetchRegistry();
  if (result.registry === null) return { checks: [], unavailable: result.unavailable };

  const checks = await Promise.all(bundled(result.registry).map(check));
  return { checks, unavailable: null };
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

/** The source's own probe, or — from a server older than probes — its first tool and that tool's example. */
function probeOf(source: RegistrySource): ResolvedProbe | null {
  if (source.probe) return source.probe;
  const first = source.tools[0];
  if (!first) return null;
  const input = Object.fromEntries(
    Object.entries(first.example ?? {}).filter((entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
  return { tool: first.name, input, expect: null };
}

/**
 * The headers that make a call the monitor's. The mark alone is only that:
 * the server skips its cache for it, and leaves it out of the history, only
 * beside `PROXY_SECRET` — the proof the /live proxy already sends.
 */
function probeHeaders(): Record<string, string> {
  const secret = process.env.PROXY_SECRET?.trim();
  return { accept: "application/json", [PROBE_HEADER]: "1", ...(secret ? { [PROXY_HEADER]: secret } : {}) };
}

async function check(source: RegistrySource): Promise<CheckResult> {
  const probe = probeOf(source);
  const key = source.key;

  // A source with no tools cannot be asked anything, so it cannot be up.
  if (!probe) {
    return { key, tool: "", health: "down", ms: 0, code: "no_tools", detail: "This source declares no tools." };
  }

  const query = new URLSearchParams(
    Object.entries(probe.input).map(([name, value]) => [name, String(value)]),
  ).toString();
  const started = Date.now();

  try {
    const response = await fetch(`${MCP_SERVER_URL}${source.api}/${probe.tool}${query ? `?${query}` : ""}`, {
      headers: probeHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;

    if (!response.ok) return { key, tool: probe.tool, health: "down", ms, ...(await reason(response)) };

    if (probe.expect && fallsShort(await dataOf(response), probe.expect)) {
      return { key, tool: probe.tool, health: "down", ms, code: "empty", detail: probe.expect.detail };
    }
    return { key, tool: probe.tool, health: ms > SLOW_MS ? "slow" : "ok", ms, code: null, detail: null };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      key,
      tool: probe.tool,
      health: "down",
      ms: Date.now() - started,
      code: timedOut ? "timeout" : "unreachable",
      detail: timedOut ? `No answer within ${TIMEOUT_MS / 1_000} seconds.` : "agoramcp could not be reached.",
    };
  }
}

/**
 * The `data` of an answer, as the API's envelope carries it, or undefined
 * when the body will not read — which then falls short of any expectation.
 */
async function dataOf(response: Response): Promise<unknown> {
  try {
    return ((await response.json()) as { data?: unknown }).data;
  } catch {
    return undefined;
  }
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
    if (code && message) return { code, detail: `${code}: ${message}` };
    if (code) return { code, detail: code };
  } catch {
    // Not JSON, or nothing at all. The status is still worth reporting.
  }
  return { code: `http_${response.status}`, detail: `The API answered ${response.status}.` };
}

/**
 * One round, checked and written: a row per mounted registry. Should our own
 * server not even say what it mounts, every registry seen lately is
 * unreachable through us — which is what a caller would find — and is
 * written as that.
 */
export async function runRound(): Promise<{ rows: ProbeRow[]; unavailable: string | null }> {
  const round = await checkAll();

  const rows: ProbeRow[] = round.unavailable
    ? (await knownSources(HISTORY_DAYS)).map((source) => ({
        source,
        tool: "",
        ok: false,
        code: "unreachable",
        detail: round.unavailable,
        durationMs: 0,
      }))
    : round.checks.map((check) => ({
        source: check.key,
        tool: check.tool,
        ok: check.health !== "down",
        code: check.code,
        detail: check.detail,
        durationMs: check.ms,
      }));

  await recordProbes(rows);
  return { rows, unavailable: round.unavailable };
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

type MonitorRead = {
  evidence: EvidenceRecord[];
  days: DayRow[];
};

/** Everything the page needs from the database, in two queries side by side. */
async function readRecord(): Promise<MonitorRead> {
  const [evidence, days] = await Promise.all([
    listEvidence(EVIDENCE_DAYS),
    listSourceHistory(HISTORY_DAYS, SLOW_MS),
  ]);
  return { evidence, days };
}

/**
 * The same, held for a minute and dropped as soon as a round is written.
 * JSON throughout: times are ISO strings, since the cache keeps JSON.
 */
const readMonitor = unstable_cache(readRecord, ["status-monitor"], {
  tags: [STATUS_TAG],
  revalidate: READ_SECONDS,
});

export type Status = {
  verdict: Verdict;
  sources: SourceStatus[];
  /** The last `HISTORY_DAYS` days of each source, by registry key (`gr/vies`). */
  history: Record<string, SourceHistory>;
  /** Why the monitor's record could not be read, when it could not. */
  monitorUnavailable: string | null;
  /** Why the list of registries came from the record rather than the server, when it did. */
  catalogueUnavailable: string | null;
  /** The monitor's newest check is old enough that opening the page should ask again. */
  roundDue: boolean;
};

/**
 * What the page shows. `fresh` reads past the minute-long cache: for the
 * reader whose view just made a round, the copy in the cache predates it.
 */
export async function loadStatus(now: Date = new Date(), { fresh = false } = {}): Promise<Status> {
  const [registry, read] = await Promise.all([fetchRegistry(), readMonitorSafely(fresh)]);
  const { evidence, days } = read.data;

  // The registries are named and linked from the server's own list. Should it
  // not answer, the record still knows which registries have been asked.
  const mounted: Mounted[] = registry.registry
    ? bundled(registry.registry).map((source) => ({
        key: source.key,
        id: source.id,
        country: source.country,
        name: greeklish(source.name),
        href: allPath(source.country, source.id),
      }))
    : evidence.map(({ source: key }) => {
        const [country = "", id = ""] = key.split("/");
        return { key, id, country, name: key, href: allPath(country, id) };
      });

  const sources = composeSources(mounted, evidence, now);
  const verdict: Verdict = read.unavailable
    ? { state: "none", summary: "The record could not be read.", askedAt: null, checkedAt: null, monitorLate: false }
    : composeVerdict(sources, now);
  return {
    verdict,
    sources,
    history: buildHistory(days, mounted.map((source) => source.key), now),
    monitorUnavailable: read.unavailable,
    catalogueUnavailable: registry.registry ? null : registry.unavailable,
    // A record that will not read would not take the round's rows either.
    roundDue: read.unavailable === null && roundDue(verdict.checkedAt, now),
  };
}

/**
 * Whether this view makes the next round: it is due, and no other reader
 * has just claimed it. One short write, and only when a round is due.
 */
export async function claimViewRound(status: Status): Promise<boolean> {
  if (!status.roundDue) return false;
  try {
    return await claimRound(ASK_AGAIN_MINUTES);
  } catch (error) {
    console.error("status: could not claim a round", error);
    return false;
  }
}

/**
 * The round a view claimed, made while its page streams. Once the response
 * is sent the cached read is let go, so every reader after this one sees the
 * round too. A round that fails is logged, and the reader gets whatever the
 * record holds.
 */
export async function makeViewRound(): Promise<void> {
  try {
    await runRound();
  } catch (error) {
    console.error("status: the round a view started failed", error);
  } finally {
    after(() => revalidateTag(STATUS_TAG, { expire: 0 }));
  }
}

/** A database that cannot be reached is a sentence on the page, not a crash. */
async function readMonitorSafely(fresh: boolean): Promise<{ data: MonitorRead; unavailable: string | null }> {
  try {
    return { data: await (fresh ? readRecord() : readMonitor()), unavailable: null };
  } catch (error) {
    console.error("status: database unavailable", error);
    return {
      data: { evidence: [], days: [] },
      unavailable: "The record of calls could not be read just now, so there is nothing to report.",
    };
  }
}
