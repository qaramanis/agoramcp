/**
 * What landed, and when. Hand-written and newest first: the dates are the
 * repository's, but this is the public reading of that history rather than a
 * second copy of it — a change nobody outside the codebase would notice does
 * not get an entry here.
 *
 * The page groups by date, so entries for one day sit in the order they should
 * be read, not one heading each.
 */

/**
 * Which layer moved. `source` is a registry arriving or changing shape,
 * `server` is the thing that serves it, `site` is this website.
 */
export type ChangeKind = "source" | "server" | "site";

export type Change = {
  /** ISO 8601, and the key the page groups by. */
  date: string;
  kind: ChangeKind;
  title: string;
  body: string;
  /**
   * Where to go and read the thing itself. Left out where an entry has no
   * page of its own — the first commit has nothing to link to.
   */
  href?: string;
};

export const KIND_LABELS: Record<ChangeKind, string> = {
  source: "Source",
  server: "Server",
  site: "Site",
};

export const changes: Change[] = [
  {
    date: "2026-09-07",
    kind: "site",
    title: "Use cases",
    body: "Four questions worked end to end — public spending, a procurement, an open dataset, a public service — each naming the tools it takes and the registries behind them.",
    href: "/use-cases/public-spending",
  },
  {
    date: "2026-09-01",
    kind: "source",
    title: "Four registries joined Diavgeia",
    body: "KIMDIS for public procurement, Mitos for administrative procedures, data.gov.gr for the national open-data catalogue, and Dimos Athinaion for the City of Athens portal.",
    href: "/all/gr",
  },
  {
    date: "2026-09-01",
    kind: "server",
    title: "One adapter for CKAN portals",
    body: "data.gov.gr and the Athens portal both run CKAN, so they share one adapter pointed at two hosts. A third CKAN portal is now its licence, its name and its address — not a new set of tools.",
  },
  {
    date: "2026-09-01",
    kind: "server",
    title: "The HTTP API",
    body: "Every tool the MCP servers mount also answers a plain GET or POST, with the licence and attribution in the envelope of each response.",
    href: "/api",
  },
  {
    date: "2026-09-01",
    kind: "site",
    title: "The catalogue",
    body: "Every country, every source and every tool with its arguments and its example, read off the running server rather than typed out.",
    href: "/all",
  },
  {
    date: "2026-09-01",
    kind: "site",
    title: "Requests for a country are recorded",
    body: "The request form now keeps what it is sent, so the countries people ask for are counted rather than read once and lost.",
    href: "/country",
  },
  {
    date: "2026-09-01",
    kind: "server",
    title: "Country servers",
    body: "One address per country bundles every registry it mounts, and tool names carry the registry that answers them — diavgeia_get_decision on the country server, get_decision on the source's own.",
    href: "/mcp",
  },
  {
    date: "2026-09-01",
    kind: "site",
    title: "Quickstart guides",
    body: "The command or the config entry for each client, and where its file lives.",
    href: "/quickstart",
  },
  {
    date: "2026-08-31",
    kind: "source",
    title: "Diavgeia",
    body: "The first registry: every administrative act the Greek state publishes under the Transparency Programme, searchable by body, subject and date.",
    href: "/all/gr/diavgeia",
  },
  {
    date: "2026-08-31",
    kind: "site",
    title: "The site, and the live console",
    body: "Landing page, navigation and footer, and a console that runs a real call in the browser against a tool you pick.",
    href: "/live",
  },
  {
    date: "2026-08-29",
    kind: "server",
    title: "First commit",
    body: "The workspace, the Source interface, the HTTP client, the cache and the errors — the shape every source has been written against since.",
  },
];

/**
 * Entries grouped by date, newest day first and each day's entries in the
 * order they are written above. Dates are compared as strings, which ISO 8601
 * makes the same as comparing them as dates.
 */
export function changesByDate(): [string, Change[]][] {
  const days = new Map<string, Change[]>();
  for (const change of changes) {
    const day = days.get(change.date);
    if (day) day.push(change);
    else days.set(change.date, [change]);
  }
  return [...days].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * The day the newest entry landed, for the line under the heading. Written
 * out rather than relative — "3 days ago" is a fact that rots in a cache.
 */
export function latestChange(): Change | undefined {
  return changes[0];
}

/** "1 September 2026" — the same wording the entries' headings use. */
export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
