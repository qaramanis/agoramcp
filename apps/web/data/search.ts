/**
 * The search index. Nothing is fetched — until there is an API, the nav
 * content is what there is to search.
 */
import { features, productItems, resourceCountries } from "./menu";

export type SearchResult = {
  title: string;
  description: string;
  group: string;
  url: string;
};

export const MIN_QUERY = 2;

const searchIndex: SearchResult[] = [
  ...resourceCountries.flatMap((country) =>
    country.sources.map((source) => ({ ...source, group: country.label })),
  ),
  ...productItems.map((item) => ({ ...item, group: "Product" })),
  ...features.map((item) => ({ ...item, group: "Features" })),
];

/** Results grouped the way the resources panel groups countries. */
export function searchContent(query: string): [string, SearchResult[]][] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];

  const groups = new Map<string, SearchResult[]>();
  for (const item of searchIndex) {
    if (
      !item.title.toLowerCase().includes(q) &&
      !item.description.toLowerCase().includes(q)
    ) {
      continue;
    }
    const bucket = groups.get(item.group);
    if (bucket) bucket.push(item);
    else groups.set(item.group, [item]);
  }
  return [...groups];
}
