import { requestCountries } from "./countries";
import { greeklish } from "./greeklish";
import {
  fieldsFor,
  firstSentence,
  type InputSchema,
  type PlaygroundCountry,
  type PlaygroundProvider,
} from "./playground";

/**
 * The playground's catalogue, read off the MCP server's `GET /`. Server-side
 * only: the browser gets the result as props, never the server's address.
 */

/** Loopback in dev; a private address once the server is deployed. */
export const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3000";

/**
 * How stale the tool list may be. A new source is one server restart away, not
 * one page view, so a minute between reads costs nothing anyone will notice.
 */
const REVALIDATE_SECONDS = 60;

/** What `describeRegistry` and `describeBundles` put on the wire. */
type RegistryTool = {
  name: string;
  title: string;
  description: string;
  inputSchema?: InputSchema;
  example?: Record<string, unknown>;
};

type RegistrySource = {
  country: string;
  id: string;
  name: string;
  endpoint: string;
  publisher: string;
  license: string;
  attribution: string;
  upstreamUrl: string;
  tools: RegistryTool[];
};

type Registry = {
  countries?: { country: string; name: string }[];
  sources?: RegistrySource[];
};

export type Catalogue = {
  countries: PlaygroundCountry[];
  /** Why the list is empty, when it is empty for a reason worth showing. */
  unavailable: string | null;
};

export async function loadCatalogue(): Promise<Catalogue> {
  let registry: Registry;

  try {
    const response = await fetch(`${MCP_SERVER_URL}/`, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      return { countries: [], unavailable: `The MCP server answered ${response.status}.` };
    }
    registry = (await response.json()) as Registry;
  } catch {
    return { countries: [], unavailable: "The MCP server could not be reached." };
  }

  return { countries: toCountries(registry), unavailable: null };
}

/**
 * Sources grouped by country, in the order the server lists them. The country
 * server's name is used where there is one; a country whose sources are all
 * kept off it falls back to the ISO list the request form uses.
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

  return [...byCode.values()];
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
