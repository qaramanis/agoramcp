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
  /** What went wrong, when something did. */
  detail: string | null;
};

export type Status = {
  sources: SourceStatus[];
  /** When the checks ran — the render, since nothing here is cached. */
  checkedAt: Date;
  /** Why there is nothing: our own server did not answer at all. */
  unavailable: string | null;
};

/** Past this, a call is reported as slow rather than as an answer. */
export const SLOW_MS = 3_000;

/** Past this, it is reported as no answer at all. */
export const TIMEOUT_MS = 10_000;

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
  const result = await fetchRegistry();
  if (result.registry === null) {
    return { sources: [], checkedAt: new Date(), unavailable: result.unavailable };
  }

  // In parallel: five sequential round trips would make the page's own
  // latency the sum of the registries' rather than the slowest of them.
  const sources = await Promise.all(bundled(result.registry).map(check));
  sources.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  return { sources, checkedAt: new Date(), unavailable: null };
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
    return { ...base, path: source.api, health: "down", ms: 0, detail: "This source declares no tools." };
  }

  const query = new URLSearchParams(
    Object.entries(tool.example ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString();
  const path = `${source.api}/${tool.name}`;
  const started = Date.now();

  try {
    const response = await fetch(`${MCP_SERVER_URL}${path}${query ? `?${query}` : ""}`, {
      headers: { accept: "application/json" },
      // Never cached here: a status page that reads a cached check is
      // reporting the past while dating it now.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;

    if (!response.ok) return { ...base, path, health: "down", ms, detail: await reason(response) };
    return { ...base, path, health: ms > SLOW_MS ? "slow" : "ok", ms, detail: null };
  } catch {
    return {
      ...base,
      path,
      health: "down",
      ms: Date.now() - started,
      detail: `No answer within ${TIMEOUT_MS / 1_000} seconds.`,
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
 * those rather than paraphrasing a status number.
 */
async function reason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    const code = body.error?.code;
    const message = body.error?.message?.split("\n")[0]?.trim();
    if (code && message) return `${code} — ${message}`;
    if (code) return code;
  } catch {
    // Not JSON, or nothing at all. The status is still worth reporting.
  }
  return `The API answered ${response.status}.`;
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
