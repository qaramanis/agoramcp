import { greeklish } from "./greeklish";
import {
  DATE_PATTERN,
  firstSentence,
  type InputSchema,
  type PropertySchema,
} from "./playground";
import {
  fetchRegistry,
  type Registry,
  type RegistryCountry,
  type RegistrySource,
  type RegistryTool,
} from "./registry";

/**
 * The catalogue pages' view of the registry: every country server, the sources
 * it bundles, and every tool with its arguments spelled out — the full
 * reference the playground's shape (`data/catalogue.ts`) has no use for. Read
 * off the same `GET /`, so a new source is on `/all` the moment the server
 * mounts it.
 *
 * A source kept off its country's server (the server's `UNBUNDLED` list) is
 * kept off the catalogue too: the bundle is the server's own statement of what
 * a country serves, and the catalogue repeats it rather than second-guess it.
 */

export type ToolArgument = {
  name: string;
  /** The JSON Schema type: string, integer, boolean. */
  type: string;
  required: boolean;
  description: string;
  /** The schema's bounds in words — "one of a, b", "1–100", "YYYY-MM-DD" — or null. */
  constraint: string | null;
};

export type DirectoryTool = {
  name: string;
  title: string;
  /** The whole description, as the model reads it. */
  description: string;
  arguments: ToolArgument[];
  example: Record<string, unknown>;
};

export type DirectorySource = {
  id: string;
  country: string;
  countryName: string;
  name: string;
  /** One line: the first sentence of the description. */
  summary: string;
  description: string;
  publisher: string;
  license: string;
  /** A licence condition, not a footnote — it travels with the data. */
  attribution: string;
  upstreamUrl: string;
  /** Mount path on the MCP server: `/{country}/mcp/{source}`. */
  endpoint: string;
  /** Root of the HTTP API for the source: `/{country}/api/{source}`. */
  api: string;
  /** What the country server puts in front of this source's tool names. */
  prefix: string;
  tools: DirectoryTool[];
};

export type DirectoryCountry = {
  code: string;
  name: string;
  description: string;
  /** The country server: `/{country}/mcp`. */
  endpoint: string;
  /** The country's API index: `/{country}/api`. */
  api: string;
  sources: DirectorySource[];
};

export type Directory = {
  countries: DirectoryCountry[];
  /** Why the list is empty, when it is empty for a reason worth showing. */
  unavailable: string | null;
};

export async function loadDirectory(): Promise<Directory> {
  const result = await fetchRegistry();
  if (result.registry === null) return { countries: [], unavailable: result.unavailable };
  return { countries: toCountries(result.registry), unavailable: null };
}

/** The catalogue's own addresses: `/all`, `/all/gr`, `/all/gr/diavgeia`. */
export function allPath(country?: string, source?: string): string {
  if (!country) return "/all";
  return source ? `/all/${country}/${source}` : `/all/${country}`;
}

export function findCountry(directory: Directory, code: string): DirectoryCountry | undefined {
  return directory.countries.find((country) => country.code === code);
}

export function findSource(country: DirectoryCountry, id: string): DirectorySource | undefined {
  return country.sources.find((source) => source.id === id);
}

export function toolCount(country: DirectoryCountry): number {
  return country.sources.reduce((total, source) => total + source.tools.length, 0);
}

/**
 * Countries and sources alphabetical by the name the page shows, not in the
 * order the server imported them.
 */
function toCountries(registry: Registry): DirectoryCountry[] {
  const byKey = new Map((registry.sources ?? []).map((source) => [source.key, source]));

  return (registry.countries ?? [])
    .map((bundle) => ({
      code: bundle.country,
      name: bundle.name,
      description: bundle.description,
      endpoint: bundle.endpoint,
      api: bundle.api,
      sources: bundle.sources
        .flatMap((entry) => {
          const source = byKey.get(`${bundle.country}/${entry.id}`);
          return source ? [toSource(source, bundle, entry.prefix)] : [];
        })
        .sort((a, b) => byName(a.name, b.name)),
    }))
    .sort((a, b) => byName(a.name, b.name));
}

/** Alphabetical as a reader sees it: case and accents do not split the list. */
function byName(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function toSource(source: RegistrySource, bundle: RegistryCountry, prefix: string): DirectorySource {
  return {
    id: source.id,
    country: source.country,
    countryName: bundle.name,
    // Names are transliterated for the page; descriptions, codes and values
    // are shown as the registry wrote them.
    name: greeklish(source.name),
    summary: firstSentence(source.description),
    description: source.description,
    publisher: greeklish(source.publisher),
    license: source.license,
    attribution: greeklish(source.attribution),
    upstreamUrl: source.upstreamUrl,
    endpoint: source.endpoint,
    api: source.api,
    prefix,
    tools: source.tools.map(toTool),
  };
}

function toTool(tool: RegistryTool): DirectoryTool {
  return {
    name: tool.name,
    title: greeklish(tool.title),
    description: tool.description,
    arguments: argumentsFor(tool.inputSchema ?? {}),
    example: tool.example ?? {},
  };
}

/** One row per schema property, in schema order. */
function argumentsFor(schema: InputSchema): ToolArgument[] {
  const required = new Set(schema.required ?? []);

  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    type: property.type ?? "string",
    required: required.has(name),
    description: property.description ?? "",
    constraint: constraintFor(property),
  }));
}

/**
 * `z.int()` stamps the biggest safe integer as its maximum; that is "no
 * maximum" to a reader, so it is not printed as one.
 */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/** The schema's bounds, in the words a reference would use. */
function constraintFor(property: PropertySchema): string | null {
  const parts: string[] = [];

  if (Array.isArray(property.enum)) {
    parts.push(`one of ${property.enum.map(String).join(", ")}`);
  }

  if (property.pattern === DATE_PATTERN) {
    parts.push("YYYY-MM-DD");
  } else if (property.pattern) {
    parts.push(`matches ${property.pattern}`);
  }

  const max = property.maximum !== undefined && property.maximum < UNBOUNDED ? property.maximum : undefined;
  if (property.minimum !== undefined && max !== undefined) parts.push(`${property.minimum}–${max}`);
  else if (property.minimum !== undefined) parts.push(`≥ ${property.minimum}`);
  else if (max !== undefined) parts.push(`≤ ${max}`);

  // A minimum length of one only says "not empty", which every argument means.
  if (property.minLength !== undefined && property.minLength > 1 && property.maxLength !== undefined) {
    parts.push(`${property.minLength}–${property.maxLength} characters`);
  } else if (property.maxLength !== undefined) {
    parts.push(`up to ${property.maxLength} characters`);
  } else if (property.minLength !== undefined && property.minLength > 1) {
    parts.push(`at least ${property.minLength} characters`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * What the searchable catalogue on `/all` is handed. A summary, not the
 * directory itself: the tool descriptions run to a paragraph each and the
 * browser only needs names to filter on.
 */
export type CatalogueSource = {
  id: string;
  country: string;
  countryName: string;
  name: string;
  publisher: string;
  summary: string;
  license: string;
  toolCount: number;
  href: string;
};

export type CatalogueCountry = {
  code: string;
  name: string;
  toolCount: number;
  href: string;
  sources: CatalogueSource[];
};

export function toCatalogue(countries: DirectoryCountry[]): CatalogueCountry[] {
  return countries.map((country) => ({
    code: country.code,
    name: country.name,
    toolCount: toolCount(country),
    href: allPath(country.code),
    sources: country.sources.map(toCatalogueSource),
  }));
}

/** A source as a row in a list — on `/all` and on its country's page. */
export function toCatalogueSource(source: DirectorySource): CatalogueSource {
  return {
    id: source.id,
    country: source.country,
    countryName: source.countryName,
    name: source.name,
    publisher: source.publisher,
    summary: source.summary,
    license: source.license,
    toolCount: source.tools.length,
    href: allPath(source.country, source.id),
  };
}
