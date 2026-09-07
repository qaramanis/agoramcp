import {
  defineBundle,
  qualifiedToolName,
  sourceKey,
  toolPrefix,
  type AnySourceTool,
  type Bundle,
  type Source,
} from "@agoramcp/core";
import { athensSource } from "@agoramcp/source-gr-athens";
import { datagovSource } from "@agoramcp/source-gr-datagov";
import { diavgeiaSource } from "@agoramcp/source-gr-diavgeia";
import { kimdisSource } from "@agoramcp/source-gr-kimdis";
import { mitosSource } from "@agoramcp/source-gr-mitos";
import { viesSource } from "@agoramcp/source-gr-vies";
import { z } from "zod";

/**
 * The only place a source is wired in. To add one: create the package under
 * `packages/sources/{country}/{id}`, add it to this app's dependencies, and
 * import it here. The server itself needs no changes.
 */
const SOURCES: readonly Source[] = [
  athensSource,
  datagovSource,
  diavgeiaSource,
  kimdisSource,
  mitosSource,
  viesSource,
];

/**
 * Sources that stay off their country's server. Membership is otherwise
 * derived, so adding a source still costs one import — it joins its country
 * automatically, and this list is the escape hatch for the ones that should
 * not — a source too noisy or too narrow to belong in its country's server.
 */
const UNBUNDLED: readonly string[] = [];

/** Display names for the country servers. Anything unlisted falls back to its code. */
const COUNTRY_NAMES: Record<string, string> = { gr: "Greece" };

/** Keyed by `{country}/{id}`, which is also the mount path. */
export type Registry = ReadonlyMap<string, Source>;

/** Keyed by country code, which is also the mount path. */
export type Bundles = ReadonlyMap<string, Bundle>;

export function buildRegistry(sources: readonly Source[] = SOURCES): Registry {
  const registry = new Map<string, Source>();

  for (const source of sources) {
    const key = sourceKey(source);
    if (registry.has(key)) {
      throw new Error(`Two sources claim "${key}". Source keys must be unique.`);
    }
    registry.set(key, source);
  }

  return registry;
}

/**
 * One bundle per country represented in the registry, mounted at
 * `/{country}/mcp`. `defineBundle` throws here rather than at call time if two
 * of a country's sources would claim the same qualified tool name.
 */
export function buildBundles(
  registry: Registry,
  unbundled: readonly string[] = UNBUNDLED,
): Bundles {
  const byCountry = new Map<string, Source[]>();

  for (const [key, source] of registry) {
    if (unbundled.includes(key)) continue;
    const members = byCountry.get(source.country);
    if (members) members.push(source);
    else byCountry.set(source.country, [source]);
  }

  const bundles = new Map<string, Bundle>();

  for (const [country, sources] of byCountry) {
    const name = COUNTRY_NAMES[country] ?? country.toUpperCase();
    bundles.set(
      country,
      defineBundle({
        country,
        meta: {
          name,
          description: `Every public registry agoramcp mounts for ${name}, in one server.`,
        },
        sources,
      }),
    );
  }

  return bundles;
}

/**
 * The two address families, built in one place so a mount and the description
 * of that mount cannot disagree. MCP stops at the source — the tool is chosen
 * inside the session — where the API goes one segment further.
 */
export function mcpPath(country: string, source?: string): string {
  return source ? `/${country}/mcp/${source}` : `/${country}/mcp`;
}

export function apiPath(country: string, source?: string, tool?: string): string {
  if (!source) return `/${country}/api`;
  return tool ? `/${country}/api/${source}/${tool}` : `/${country}/api/${source}`;
}

/** The provenance every description of a source carries, wherever it is served from. */
export function describeSourceMeta(source: Source) {
  return {
    country: source.country,
    id: source.id,
    name: source.meta.name,
    description: source.meta.description,
    publisher: source.meta.publisher,
    license: source.meta.license,
    attribution: source.meta.attribution,
    upstreamUrl: source.meta.upstreamUrl,
  };
}

/**
 * One tool as a client can act on it: the schema to build a form or a query
 * string from, and the example to start on. A tool is described once, in its
 * source; this is that description on the wire.
 */
export function describeTool(tool: AnySourceTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(z.object(tool.inputSchema)),
    example: tool.example ?? {},
  };
}

/**
 * Shape returned by `GET /` — what the landing page renders. Each source names
 * both its MCP mount (`endpoint`) and its API root (`api`), so a reader of the
 * catalogue can reach a tool either way without a second lookup.
 */
export function describeRegistry(registry: Registry) {
  return [...registry.entries()].map(([key, source]) => ({
    key,
    ...describeSourceMeta(source),
    endpoint: mcpPath(source.country, source.id),
    api: apiPath(source.country, source.id),
    tools: source.tools.map(describeTool),
  }));
}

/**
 * The country servers, as `GET /` reports them. Tool names are the qualified
 * ones this endpoint actually answers to — the bare names on the per-source
 * endpoints are already in `describeRegistry`.
 */
export function describeBundles(bundles: Bundles) {
  return [...bundles.values()].map((bundle) => ({
    country: bundle.country,
    name: bundle.meta.name,
    description: bundle.meta.description,
    endpoint: mcpPath(bundle.country),
    api: apiPath(bundle.country),
    sources: bundle.sources.map((source) => ({
      id: source.id,
      name: source.meta.name,
      prefix: `${toolPrefix(source)}_`,
      license: source.meta.license,
      attribution: source.meta.attribution,
      tools: source.tools.map((tool) => qualifiedToolName(source, tool)),
    })),
  }));
}
