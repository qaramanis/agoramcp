import { requestCountries } from "./countries";
import { greeklish } from "./greeklish";
import {
  fieldsFor,
  firstSentence,
  type PlaygroundCountry,
  type PlaygroundProvider,
} from "./playground";
import { fetchRegistry, type Registry, type RegistrySource } from "./registry";

/**
 * The playground's catalogue: the registry (`data/registry.ts`) shaped into
 * forms — one field per schema property, prefilled from the tool's example.
 * Server-side only: the browser gets the result as props.
 */

export type Catalogue = {
  countries: PlaygroundCountry[];
  /** Why the list is empty, when it is empty for a reason worth showing. */
  unavailable: string | null;
};

export async function loadCatalogue(): Promise<Catalogue> {
  const result = await fetchRegistry();
  if (result.registry === null) return { countries: [], unavailable: result.unavailable };
  return { countries: toCountries(result.registry), unavailable: null };
}

/**
 * Sources grouped by country, each country's sources alphabetical by the name
 * the page shows — not in the order the server lists them, which is only the
 * order they were imported in. The country server's name is used where there
 * is one; a country whose sources are all kept off it falls back to the ISO
 * list the request form uses.
 */
function toCountries(registry: Registry): PlaygroundCountry[] {
  const names = new Map((registry.countries ?? []).map((entry) => [entry.country, entry.name]));
  const byCode = new Map<string, PlaygroundCountry>();

  for (const source of registry.sources ?? []) {
    let country = byCode.get(source.country);
    if (!country) {
      country = {
        code: source.country,
        name:
          names.get(source.country) ??
          requestCountries.find((entry) => entry.code === source.country.toUpperCase())?.name ??
          source.country.toUpperCase(),
        providers: [],
      };
      byCode.set(source.country, country);
    }
    country.providers.push(toProvider(source));
  }

  for (const country of byCode.values()) {
    country.providers.sort((a, b) => byName(a.name, b.name));
  }

  return [...byCode.values()];
}

/** Alphabetical as a reader sees it: case and accents do not split the list. */
function byName(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function toProvider(source: RegistrySource): PlaygroundProvider {
  return {
    id: source.id,
    // Names are transliterated for the page; values, codes and descriptions
    // are shown as the registry wrote them.
    name: greeklish(source.name),
    endpoint: source.endpoint,
    publisher: greeklish(source.publisher),
    license: source.license,
    attribution: greeklish(source.attribution),
    upstreamUrl: source.upstreamUrl,
    tools: source.tools.map((tool) => ({
      name: tool.name,
      title: greeklish(tool.title),
      summary: firstSentence(tool.description),
      fields: fieldsFor(tool.inputSchema ?? {}, tool.example ?? {}),
    })),
  };
}
