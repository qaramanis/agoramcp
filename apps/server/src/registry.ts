import {
  defineBundle,
  qualifiedToolName,
  sourceKey,
  toolPrefix,
  type Bundle,
  type Source,
} from "@agoramcp/core";
import { diavgeiaSource } from "@agoramcp/source-gr-diavgeia";
import { testSource } from "@agoramcp/source-gr-test";
import { z } from "zod";

/**
 * The only place a source is wired in. To add one: create the package under
 * `packages/sources/{country}/{id}`, add it to this app's dependencies, and
 * import it here. The server itself needs no changes.
 */
const SOURCES: readonly Source[] = [diavgeiaSource, testSource];

/**
 * Sources that stay off their country's server. Membership is otherwise
 * derived, so adding a source still costs one import — it joins its country
 * automatically, and this list is the escape hatch for the ones that should
 * not. `gr/test` proves the transport and has no upstream behind it.
 */
const UNBUNDLED: readonly string[] = ["gr/test"];

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
 * Shape returned by `GET /` — what the landing page renders. Each tool carries
 * its input schema and its example, so the live console can build a form for
 * a tool nobody has told it about: a tool is described once, in its source.
 */
export function describeRegistry(registry: Registry) {
  return [...registry.entries()].map(([key, source]) => ({
    key,
    country: source.country,
    id: source.id,
    name: source.meta.name,
    description: source.meta.description,
    endpoint: `/${key.replace("/", "/mcp/")}`,
    publisher: source.meta.publisher,
    license: source.meta.license,
    attribution: source.meta.attribution,
    upstreamUrl: source.meta.upstreamUrl,
    tools: source.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(z.object(tool.inputSchema)),
      example: tool.example ?? {},
    })),
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
    endpoint: `/${bundle.country}/mcp`,
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
