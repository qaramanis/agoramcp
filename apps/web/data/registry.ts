/**
 * The MCP server's registry, as `GET /` puts it on the wire. Server-side only:
 * every page that reads it hands the browser a shaped copy as props, never the
 * server's address. Two views are built on it — the playground's
 * (`data/catalogue.ts`) and the catalogue pages' (`data/directory.ts`) — and
 * both read through here so one server round-trip serves both.
 */
import type { InputSchema } from "./playground";

/** Loopback in dev; a private address once the server is deployed. */
export const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3000";

/**
 * How stale the tool list may be. A new source is one server restart away, not
 * one page view, so a minute between reads costs nothing anyone will notice.
 */
const REVALIDATE_SECONDS = 60;

/**
 * Long enough for a server waking from cold to answer `GET /`, which reads
 * nothing upstream; short enough that a page never hangs on one that will
 * not answer at all.
 */
const TIMEOUT_MS = 10_000;

/** What `probeFor` puts on the wire: the call the status monitor makes. */
export type RegistryProbe = {
  tool: string;
  input: Record<string, string | number | boolean>;
  expect: { field: string; atLeast: number; detail: string } | null;
};

/** What `describeTool` puts on the wire. */
export type RegistryTool = {
  name: string;
  title: string;
  description: string;
  inputSchema?: InputSchema;
  example?: Record<string, unknown>;
};

/** What `describeRegistry` puts on the wire, one per mounted source. */
export type RegistrySource = {
  key: string;
  country: string;
  id: string;
  name: string;
  description: string;
  /** Mount path on the MCP server: `/{country}/mcp/{source}`. */
  endpoint: string;
  /** Root of the HTTP API for the source: `/{country}/api/{source}`. */
  api: string;
  publisher: string;
  license: string;
  attribution: string;
  upstreamUrl: string;
  tools: RegistryTool[];
  /** Absent from a server older than probes. */
  probe?: RegistryProbe;
};

/**
 * What `describeBundles` puts on the wire: a country server and the sources
 * it bundles. A source kept off its country's server is not listed here.
 */
export type RegistryCountry = {
  country: string;
  name: string;
  description: string;
  endpoint: string;
  api: string;
  sources: { id: string; name: string; prefix: string }[];
};

export type Registry = {
  countries?: RegistryCountry[];
  sources?: RegistrySource[];
};

export type RegistryResult =
  | { registry: Registry; unavailable: null }
  /** Why there is nothing, when there is nothing for a reason worth showing. */
  | { registry: null; unavailable: string };

export async function fetchRegistry(): Promise<RegistryResult> {
  // A race rather than an abort signal: a signal would stop Next memoising
  // this fetch, and every view a page renders shares the one call.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<RegistryResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ registry: null, unavailable: `The MCP server did not answer within ${TIMEOUT_MS / 1000} s.` }),
      TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([load(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function load(): Promise<RegistryResult> {
  try {
    const response = await fetch(`${MCP_SERVER_URL}/`, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      return { registry: null, unavailable: `The MCP server answered ${response.status}.` };
    }
    return { registry: (await response.json()) as Registry, unavailable: null };
  } catch {
    return { registry: null, unavailable: "The MCP server could not be reached." };
  }
}
