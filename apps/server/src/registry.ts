import { sourceKey, type Source } from "@agoramcp/core";
import { testSource } from "@agoramcp/source-gr-test";

/**
 * The only place a source is wired in. To add one: create the package under
 * `packages/sources/{country}/{id}`, add it to this app's dependencies, and
 * import it here. The server itself needs no changes.
 */
const SOURCES: readonly Source[] = [testSource];

/** Keyed by `{country}/{id}`, which is also the mount path. */
export type Registry = ReadonlyMap<string, Source>;

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

/** Shape returned by `GET /` — what the landing page renders in step 6. */
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
    })),
  }));
}
