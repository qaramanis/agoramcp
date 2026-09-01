/**
 * The search index.
 *
 * One adapter per data module: each turns that module's own shapes into
 * `SearchResult`s, and the index is their concatenation with duplicates
 * dropped. A new module to search — page sections, the live catalogue — is
 * one more adapter in `searchIndex`, and nothing in the nav changes.
 */
import { agents } from "./agents";
import { ENVELOPE, ERROR_CODES } from "./api";
import { requestCountries } from "./countries";
import { contactLinks, footerColumns, type FooterLink } from "./footer";
import { mounts } from "./mcp";
import {
  features,
  productCards,
  productItems,
  resourceCards,
  resourceCountries,
  type DropdownItem,
} from "./menu";
import { firstSentence } from "./playground";

export type SearchResult = {
  title: string;
  /** The line under the title; "" where the source has nothing to say. */
  description: string;
  /** The heading a result is filed under in the dropdown. */
  group: string;
  url: string;
  /** Matched, never rendered — see `DropdownItem`. */
  keywords?: string[];
};

export const MIN_QUERY = 2;

/**
 * Results shown per group. Every hit in a group of three shows; once a group
 * is a country's whole tool list, the top few are all a dropdown has room for.
 */
const MAX_PER_GROUP = 5;

/**
 * Where the query matched, weighted. Matching fields add up, so a hit in the
 * title and the description outranks a hit in the title alone. The group
 * counts too, at the bottom: "greece" should find the Greek sources, not only
 * a row with Greece in its own text.
 */
const WEIGHT = { title: 3, keywords: 2, description: 1, group: 1 } as const;

function entry(item: DropdownItem, group: string): SearchResult {
  const { title, description, url, keywords } = item;
  return { title, description, url, group, keywords };
}

/** Everything the nav dropdowns list, grouped the way the panels group it. */
function fromMenu(): SearchResult[] {
  return [
    ...resourceCountries.flatMap((country) =>
      country.sources.map((source) => entry(source, country.label)),
    ),
    ...productItems.map((item) => entry(item, "Product")),
    ...productCards.map((item) => entry(item, "Product")),
    ...features.map((item) => entry(item, "Features")),
    ...resourceCards.map((item) => entry(item, "Resources")),
  ];
}

/**
 * Footer links under their column. A link is a label alone, so the row has
 * no second line; the ones the menu also lists fall away as duplicates.
 */
function fromFooter(): SearchResult[] {
  const link = (item: FooterLink, group: string): SearchResult => ({
    title: item.label,
    description: "",
    url: item.href,
    group,
    keywords: item.keywords,
  });
  return [
    ...footerColumns.flatMap((column) =>
      column.links.map((item) => link(item, column.title)),
    ),
    ...contactLinks.map((item) => link(item, "Contact")),
  ];
}

/** The two address shapes a client can point at, findable by example too. */
function fromMounts(): SearchResult[] {
  return mounts.map((mount) => ({
    title: mount.label,
    description: mount.pattern,
    url: "/mcp",
    group: "MCP",
    keywords: [mount.path, mount.clientName],
  }));
}

/**
 * One row per client in the connect walkthrough, landing on that client's
 * own section. The config file names are keywords, so "mcp.json" finds the
 * clients that use one.
 */
function fromAgents(): SearchResult[] {
  return agents.map((agent) => ({
    title: agent.name,
    description: firstSentence(agent.summary),
    url: `/quickstart#connect-${agent.id}`,
    group: "Quickstart",
    keywords: [agent.ui?.title, ...(agent.configs ?? []).map((c) => c.title)]
      .filter((keyword): keyword is string => keyword !== undefined),
  }));
}

/**
 * The API's error vocabulary and response envelope, as /api tables them. An
 * error code is also searchable as words — "rate limit" finds `rate_limited`.
 */
function fromApi(): SearchResult[] {
  return [
    ...ERROR_CODES.map((error) => ({
      title: error.code,
      description: `${error.status} — ${error.meaning}`,
      url: "/api",
      group: "API errors",
      keywords: [error.code.replace(/_/g, " ")],
    })),
    ...ENVELOPE.map((field) => ({
      title: field.key,
      description: field.meaning,
      url: "/api",
      group: "API envelope",
    })),
  ];
}

/**
 * Every country the request form offers, minus the ones the menu already
 * serves — a served country has its sources to find instead. Last in the
 * index, so on an equal match everything else comes first.
 */
function fromCountries(): SearchResult[] {
  const served = new Set(
    resourceCountries.map((country) => country.code.toUpperCase()),
  );
  return requestCountries
    .filter((country) => !served.has(country.code))
    .map((country) => ({
      title: country.name,
      description: "Not supported yet, request it",
      url: "/country",
      group: "Request a country",
      keywords: [country.code],
    }));
}

/**
 * The first of two rows with the same title and address stays, so the
 * module listed earlier supplies it — the menu's described "Quickstart"
 * rather than the footer's bare one.
 */
function dedupe(entries: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return entries.filter((item) => {
    const key = `${item.url}\n${item.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const searchIndex: SearchResult[] = dedupe([
  ...fromMenu(),
  ...fromFooter(),
  ...fromMounts(),
  ...fromAgents(),
  ...fromApi(),
  ...fromCountries(),
]);

function score(item: SearchResult, q: string): number {
  let total = 0;
  if (item.title.toLowerCase().includes(q)) total += WEIGHT.title;
  if (item.keywords?.some((keyword) => keyword.toLowerCase().includes(q))) {
    total += WEIGHT.keywords;
  }
  if (item.description.toLowerCase().includes(q)) total += WEIGHT.description;
  if (item.group.toLowerCase().includes(q)) total += WEIGHT.group;
  return total;
}

/**
 * Results grouped for the dropdown: groups ordered by their best hit, hits
 * within a group by score, and ties in index order — so for equal matches the
 * panels' own ordering holds.
 */
export function searchContent(query: string): [string, SearchResult[]][] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];

  const groups = new Map<string, { item: SearchResult; score: number }[]>();
  for (const item of searchIndex) {
    const hit = score(item, q);
    if (hit === 0) continue;
    const bucket = groups.get(item.group);
    if (bucket) bucket.push({ item, score: hit });
    else groups.set(item.group, [{ item, score: hit }]);
  }

  return [...groups]
    .map(([group, hits]) => {
      hits.sort((a, b) => b.score - a.score);
      return {
        group,
        best: hits[0].score,
        items: hits.slice(0, MAX_PER_GROUP).map((hit) => hit.item),
      };
    })
    .sort((a, b) => b.best - a.best)
    .map(({ group, items }): [string, SearchResult[]] => [group, items]);
}
