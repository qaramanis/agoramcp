import { cacheKey, defineTool, InvalidInputError, NotFoundError, withCache, type ToolContext } from "@agoramcp/core";
import { z } from "zod";
import {
  fetchProcedure,
  fetchWikiSearch,
  loadFacets,
  loadOrganizations,
  loadProcedureList,
  type Organization,
  type ProcedureFacets,
  type ProcedureListing,
} from "./client.ts";

const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 20;

/** Enough to be a word fragment rather than a letter that matches everything. */
const MIN_QUERY_LENGTH = 2;

/**
 * How many full-text hits to consider behind the title matches. The wiki
 * ranks by relevance, so what matters is at the top; the total is reported
 * either way.
 */
const WIKI_HITS = 50;

const procedureId = z
  .string()
  .trim()
  .regex(/^\d+$/u, "A procedure id is digits only, e.g. 106576.")
  .describe("The procedure's registration code, from search_procedures or from its id.mitos.gov.gr address, e.g. 106576.");

const organizationId = z
  .string()
  .trim()
  .regex(/^\d+$/u, "An organisation id is digits only, e.g. 46278.")
  .describe("Numeric id of the body, from search_organizations or from `owner.id` on a procedure.");

const limit = z
  .number()
  .int()
  .min(1)
  .max(MAX_RESULTS)
  .optional()
  .describe(`Most results to return, 1-${MAX_RESULTS}. Defaults to ${DEFAULT_RESULTS}.`);

/**
 * Matching ignores case and accents, so "Γέννηση", "γεννηση" and "ΓΕΝΝΗΣΗ"
 * are one word. Decomposing and dropping the combining marks does the accent
 * half; uppercasing afterwards folds the final ς onto Σ for free.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase();
}

/** Exact before prefix before substring, so the procedure named for the query leads. */
function rank(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return 2;
}

/** Ids compare as numbers: the wiki drops the leading zeros the register keeps. */
function sameId(a: string | null, b: string): boolean {
  return a !== null && a.replace(/^0+/u, "") === b.replace(/^0+/u, "");
}

/* -------------------------------------------------------------------------- */
/* Procedures                                                                 */
/* -------------------------------------------------------------------------- */

interface Match {
  listing: ProcedureListing;
  rank: number;
  matchedBy: "title" | "text";
  snippet: string | null;
}

export const searchProceduresTool = defineTool({
  name: "search_procedures",
  title: "Find a public-service procedure",
  description:
    "Find procedures in the Greek registry of administrative procedures — what a person or business can ask the state for: certificates, licences, benefits, registrations. " +
    "Returns each match's id, title and when it was last edited; pass the id to get_procedure for the documents, cost, steps and law. " +
    "`query` matches titles first, then the full text of the records — descriptions, document lists, steps — so it finds procedures a title alone would miss; case and accents are ignored. " +
    "`lifeEvent`, `audience` and `organizationId` narrow the set: the life event it belongs to (list_life_events), who it is for (list_audiences), or the body that owns it (search_organizations). Filters combine with AND, and a query is optional when any filter is given. " +
    "This is the usual first step when the user describes a need — 'I need a copy of my birth certificate', 'how do I open a café' — rather than names a procedure.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(MIN_QUERY_LENGTH)
      .max(200)
      .optional()
      .describe("Words from the procedure's name or its description, in Greek. Accents and case are ignored; words are ANDed."),
    lifeEvent: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Only procedures filed under this life event, named exactly as list_life_events gives it — e.g. 'Γέννηση', 'Συνταξιοδότηση'."),
    audience: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Only procedures for this audience, named exactly as list_audiences gives it — e.g. 'Πολίτες', 'Επιχειρήσεις', 'Δημόσιους Υπαλλήλους'."),
    organizationId: organizationId.optional().describe("Only procedures owned by this body, by its id from search_organizations."),
    limit,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { query: "ληξιαρχική πράξη γέννησης", limit: 5 },
  async handler(input, context) {
    if (!input.query && !input.lifeEvent && !input.audience && !input.organizationId) {
      throw new InvalidInputError("Give a query, or at least one of lifeEvent, audience and organizationId.");
    }

    const listing = await loadProcedureList(context.cache, context.signal);
    const notes: string[] = [];

    // The facet index is swept from the wiki and held; it is only read when
    // a filter needs it, so a plain query stays a cheap call on a cold host.
    let candidates = listing;
    if (input.lifeEvent || input.audience || input.organizationId) {
      const facets = await loadFacets(context.cache, context.signal);
      const lifeEvent = input.lifeEvent ? fold(input.lifeEvent) : null;
      const audience = input.audience ? fold(input.audience) : null;

      if (lifeEvent && !hasFacetValue(facets, "lifeEvents", lifeEvent)) {
        notes.push(`No procedure is filed under a life event named "${input.lifeEvent}". list_life_events gives the names in use.`);
      }
      if (audience && !hasFacetValue(facets, "audiences", audience)) {
        notes.push(`No procedure is addressed to an audience named "${input.audience}". list_audiences gives the names in use.`);
      }

      candidates = listing.filter((entry) => {
        const facet = facets.get(entry.id);
        if (!facet) return false;
        if (lifeEvent && !facet.lifeEvents.some((name) => fold(name) === lifeEvent)) return false;
        if (audience && !facet.audiences.some((name) => fold(name) === audience)) return false;
        if (input.organizationId && !sameId(facet.ownerId, input.organizationId)) return false;
        return true;
      });
    }

    const size = input.limit ?? DEFAULT_RESULTS;
    let matches: Match[];
    let fullText: { totalHits: number; considered: number; unmatched: number } | null = null;

    if (input.query) {
      const needle = fold(input.query);
      const matched = new Map<string, Match>();

      for (const entry of candidates) {
        const title = fold(entry.title);
        const titleEn = entry.titleEn ? fold(entry.titleEn) : "";
        if (title.includes(needle)) {
          matched.set(entry.id, { listing: entry, rank: rank(title, needle), matchedBy: "title", snippet: null });
        } else if (titleEn.includes(needle)) {
          matched.set(entry.id, { listing: entry, rank: rank(titleEn, needle), matchedBy: "title", snippet: null });
        }
      }

      // Behind the title matches, whatever the wiki finds in the records'
      // text, in its relevance order. A hit is joined to the list by title.
      const search = await withCache(
        context.cache,
        cacheKey("gr/mitos:wiki_search", input.query),
        context.ttl,
        () => fetchWikiSearch(input.query ?? "", WIKI_HITS, context.signal),
      );
      const byTitle = new Map(listing.map((entry) => [fold(entry.title), entry]));
      const eligible = new Set(candidates.map((entry) => entry.id));
      let unmatched = 0;
      for (const hit of search.hits) {
        const entry = byTitle.get(fold(hit.title));
        if (!entry) {
          // A page the API list spells differently, or one it does not carry.
          unmatched += 1;
          continue;
        }
        if (!eligible.has(entry.id) || matched.has(entry.id)) continue;
        matched.set(entry.id, { listing: entry, rank: 3, matchedBy: "text", snippet: hit.snippet });
      }

      fullText = { totalHits: search.totalHits, considered: search.hits.length, unmatched };
      matches = [...matched.values()];
      // Title matches by strength then length; text matches keep the wiki's order.
      matches.sort((a, b) =>
        a.rank !== b.rank
          ? a.rank - b.rank
          : a.rank === 3
            ? 0
            : a.listing.title.length - b.listing.title.length || a.listing.title.localeCompare(b.listing.title, "el"),
      );
    } else {
      matches = candidates
        .map((entry): Match => ({ listing: entry, rank: 0, matchedBy: "title", snippet: null }))
        .sort((a, b) => a.listing.title.localeCompare(b.listing.title, "el"));
    }

    if (fullText && fullText.totalHits > fullText.considered) {
      notes.push(
        `The full-text search matched ${fullText.totalHits} records and the ${fullText.considered} most relevant were considered; add words to the query to narrow it.`,
      );
    }

    return {
      query: input.query ?? null,
      lifeEvent: input.lifeEvent ?? null,
      audience: input.audience ?? null,
      organizationId: input.organizationId ?? null,
      total: matches.length,
      returned: Math.min(matches.length, size),
      hasMore: matches.length > size,
      fullText,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
      procedures: matches.slice(0, size).map((match) => ({
        ...match.listing,
        matchedBy: match.matchedBy,
        snippet: match.snippet,
      })),
    };
  },
});

function hasFacetValue(
  facets: ReadonlyMap<string, ProcedureFacets>,
  field: "lifeEvents" | "audiences",
  folded: string,
): boolean {
  for (const facet of facets.values()) {
    if (facet[field].some((name) => fold(name) === folded)) return true;
  }
  return false;
}

export const getProcedureTool = defineTool({
  name: "get_procedure",
  title: "Get a procedure in full",
  description:
    "Fetch one procedure's complete record by its id: what it is and who it is for, the body that owns it and where it is provided (municipality, ΚΕΠ, gov.gr, myKEPlive), the documents the applicant must bring and who issues each, the cost and fees, the conditions, the steps in person and the steps online with how long each takes, the legal deadline, how long the result stays valid, and the laws and Gazette issues behind it. " +
    "This answers 'what do I need to bring?', 'how much does it cost?', 'can I do it online?' and 'which law says so?'. " +
    "Use search_procedures when you have a need rather than an id. Durations are ISO 8601 with a plain reading beside each.",
  inputSchema: {
    id: procedureId,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { id: "106576" },
  async handler(input, context) {
    return withCache(
      context.cache,
      cacheKey("gr/mitos:get_procedure", input.id),
      context.ttl,
      () => fetchProcedure(input.id, context.signal),
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Facet vocabularies                                                         */
/* -------------------------------------------------------------------------- */

const MAX_FACET_RESULTS = 300;

const facetQuery = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .optional()
  .describe("Part of a name, to find the exact spelling. Accents and case are ignored. Omit for the whole list.");

/** The values of one facet across every procedure, with how many carry each. */
function countFacet(
  facets: ReadonlyMap<string, ProcedureFacets>,
  field: "lifeEvents" | "audiences",
  query: string | undefined,
): { name: string; procedures: number }[] {
  const counts = new Map<string, number>();
  for (const facet of facets.values()) {
    for (const name of facet[field]) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const needle = query === undefined ? null : fold(query);
  return [...counts.entries()]
    .filter(([name]) => needle === null || fold(name).includes(needle))
    .map(([name, procedures]) => ({ name, procedures }))
    .sort((a, b) => b.procedures - a.procedures || a.name.localeCompare(b.name, "el"));
}

export const listLifeEventsTool = defineTool({
  name: "list_life_events",
  title: "List life events",
  description:
    "List the life events the registry files procedures under — Γέννηση, Γάμος, Συνταξιοδότηση, Έναρξη και λύση επιχείρησης and about 120 more — with how many procedures each has. " +
    "The names are the exact values `lifeEvent` on search_procedures takes; call this to find the right one rather than guessing, or to see what the registry covers.",
  inputSchema: {
    query: facetQuery,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { query: "επιχείρ" },
  async handler(input, context) {
    const facets = await loadFacets(context.cache, context.signal);
    const lifeEvents = countFacet(facets, "lifeEvents", input.query);
    return {
      query: input.query ?? null,
      total: lifeEvents.length,
      lifeEvents: lifeEvents.slice(0, MAX_FACET_RESULTS),
    };
  },
});

export const listAudiencesTool = defineTool({
  name: "list_audiences",
  title: "List audiences",
  description:
    "List who the registry's procedures are addressed to — Πολίτες, Επιχειρήσεις, Δημόσιους Υπαλλήλους, Αγρότες, Φοιτητές/σπουδαστές and about 190 more — with how many procedures each has. " +
    "The names are the exact values `audience` on search_procedures takes; call this to find the right one rather than guessing.",
  inputSchema: {
    query: facetQuery,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { query: "φοιτητ" },
  async handler(input, context) {
    const facets = await loadFacets(context.cache, context.signal);
    const audiences = countFacet(facets, "audiences", input.query);
    return {
      query: input.query ?? null,
      total: audiences.length,
      audiences: audiences.slice(0, MAX_FACET_RESULTS),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Recent changes                                                             */
/* -------------------------------------------------------------------------- */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Use YYYY-MM-DD.")
  .describe("Calendar date, YYYY-MM-DD.");

export const listRecentProceduresTool = defineTool({
  name: "list_recent_procedures",
  title: "List recently edited procedures",
  description:
    "List the procedures whose records were most recently edited, newest first — the registry's changelog. " +
    "An edit is any change to the record: a new document requirement, a corrected step, a new law cited, or a wording fix; the registry does not say which. " +
    "Use `since` to see everything edited on or after a date, e.g. to check what changed this month.",
  inputSchema: {
    since: isoDate.optional().describe("Only procedures edited on or after this date, inclusive."),
    limit,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { limit: 5 },
  async handler(input, context) {
    const listing = await loadProcedureList(context.cache, context.signal);
    const size = input.limit ?? DEFAULT_RESULTS;

    // Timestamps carry the Athens offset, so their date part is the Athens day.
    const recent = listing
      .filter((entry) => entry.updatedAt !== null && (input.since === undefined || entry.updatedAt.slice(0, 10) >= input.since))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

    return {
      since: input.since ?? null,
      total: recent.length,
      returned: Math.min(recent.length, size),
      hasMore: recent.length > size,
      procedures: recent.slice(0, size),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Bodies                                                                     */
/* -------------------------------------------------------------------------- */

const MAX_ORGANIZATION_RESULTS = 100;
const DEFAULT_ORGANIZATION_RESULTS = 20;

/** A register row, trimmed to what identifies a body in a list of matches. */
function summarize(organization: Organization, names: ReadonlyMap<string, string>) {
  return {
    id: organization.id,
    name: organization.name,
    nameEn: organization.nameEn,
    vatId: organization.vatId,
    parentId: organization.parentId,
    parentName: organization.parentId === null ? null : (names.get(organization.parentId) ?? null),
    status: organization.status,
  };
}

export const searchOrganizationsTool = defineTool({
  name: "search_organizations",
  title: "Find a body in the procedures registry",
  description:
    "Find a public body in the registry's own list of organisations — ministries, regions, municipalities, agencies, ΚΕΠ — by name, VAT number (ΑΦΜ) or id, and get the id that search_procedures takes as `organizationId` to list the procedures a body owns. " +
    "Matching ignores case and accents. Returns each body's id, names in Greek and English, VAT number and parent body; get_organization adds the address and contact details. " +
    "Note that these ids are the procedures registry's own and differ from Διαύγεια's uids for the same bodies.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(MIN_QUERY_LENGTH)
      .max(120)
      .describe("Part of the body's name in Greek or English, or its VAT number or id. Accents and case are ignored."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ORGANIZATION_RESULTS)
      .optional()
      .describe(`Most bodies to return, 1-${MAX_ORGANIZATION_RESULTS}. Defaults to ${DEFAULT_ORGANIZATION_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { query: "υπουργείο εσωτερικών", limit: 5 },
  async handler(input, context) {
    const organizations = await loadOrganizations(context.cache, context.signal);
    const names = new Map(organizations.map((organization) => [organization.id, organization.name]));

    const query = input.query.trim();
    const needle = fold(query);
    const size = input.limit ?? DEFAULT_ORGANIZATION_RESULTS;

    const matched: { organization: Organization; rank: number; name: string }[] = [];
    for (const organization of organizations) {
      const name = fold(organization.name);
      const nameEn = organization.nameEn ? fold(organization.nameEn) : "";
      // A VAT number or an id is matched whole: a substring of one is not a
      // weaker match, it is a different body.
      const exact = organization.vatId === query || sameId(organization.id, query);

      if (exact) matched.push({ organization, rank: 0, name });
      else if (name.includes(needle)) matched.push({ organization, rank: 1 + rank(name, needle), name });
      else if (nameEn.includes(needle)) matched.push({ organization, rank: 1 + rank(nameEn, needle), name });
    }

    matched.sort(
      (a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name, "el"),
    );

    return {
      query,
      total: matched.length,
      returned: Math.min(matched.length, size),
      hasMore: matched.length > size,
      organizations: matched.slice(0, size).map((entry) => summarize(entry.organization, names)),
    };
  },
});

export const getOrganizationTool = defineTool({
  name: "get_organization",
  title: "Get a body's registry record",
  description:
    "Fetch one body's record from the procedures registry by its id: names, VAT number, address, email and telephone, the body it sits under and the bodies under it, and its founding Gazette issue. " +
    "Use search_organizations when you have a name rather than an id, and search_procedures with `organizationId` for the procedures the body owns.",
  inputSchema: {
    organizationId: organizationId.describe("Numeric id of the body, e.g. 46278."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "46278" },
  async handler(input, context) {
    const organizations = await loadOrganizations(context.cache, context.signal);
    const organization = organizations.find((entry) => sameId(entry.id, input.organizationId));
    if (!organization) {
      throw new NotFoundError(
        `No body is registered under id "${input.organizationId}". Search for it by name with search_organizations.`,
        { details: { organizationId: input.organizationId } },
      );
    }

    const names = new Map(organizations.map((entry) => [entry.id, entry.name]));
    const children = organizations
      .filter((entry) => entry.parentId !== null && sameId(entry.parentId, organization.id))
      .map((entry) => ({ id: entry.id, name: entry.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "el"));

    return {
      ...organization,
      parent:
        organization.parentId === null
          ? null
          : { id: organization.parentId, name: names.get(organization.parentId) ?? null },
      subOrganizations: children,
    };
  },
});

export const tools = [
  searchProceduresTool,
  getProcedureTool,
  listLifeEventsTool,
  listAudiencesTool,
  listRecentProceduresTool,
  searchOrganizationsTool,
  getOrganizationTool,
];

/** Shared with the warm-up: the same reads the tools make, so they land in the same cache. */
export async function prefetch(context: Pick<ToolContext, "cache" | "signal">): Promise<void> {
  await Promise.all([
    loadFacets(context.cache, context.signal),
    loadOrganizations(context.cache, context.signal),
  ]);
}
