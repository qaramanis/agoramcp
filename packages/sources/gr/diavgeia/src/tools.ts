import { cacheKey, defineTool, InvalidInputError, isAgoraError, NotFoundError, withCache, type ToolContext } from "@agoramcp/core";
import { z } from "zod";
import {
  addDays,
  attachOrganizations,
  effectiveWindow,
  extractDecisionText,
  fetchDecision,
  fetchDecisionDocument,
  fetchDecisionTypeDetail,
  fetchDecisionTypes,
  fetchDictionaries,
  fetchDictionary,
  fetchOrganizationDetail,
  fetchOrganizationPositions,
  fetchOrganizationSigners,
  fetchOrganizationUnits,
  fetchPositions,
  fetchSigner,
  fetchUnit,
  fetchVersionLog,
  issueWindow,
  loadRegister,
  MAX_WINDOW_DAYS,
  REGISTER_TTL_SECONDS,
  resolveOrganizations,
  runSearch,
  searchDecisions,
  type DayWindow,
  type DecisionText,
  type DictionaryEntry,
  type Organization,
  type OrganizationMatch,
  type OrganizationUnit,
  type Position,
  type RawDecisionType,
  type SearchResult,
  type Signer,
} from "./client.ts";

/** Upstream allows 500, but a 500-act page is not a useful model payload. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .describe("Calendar date, YYYY-MM-DD.");

/**
 * Greek capitals and digits, then a hyphen and a three-character checksum —
 * e.g. 9ΓΓ346ΝΨ2Ν-Β5Τ. Length before the hyphen has varied across the
 * programme's history, so only the shape is enforced here.
 */
const ADA = z
  .string()
  .trim()
  .regex(
    /^[0-9A-ZΑ-Ω]{4,}-[0-9A-ZΑ-Ω]{3}$/u,
    "An ΑΔΑ looks like 9ΓΓ346ΝΨ2Ν-Β5Τ: capitals and digits, a hyphen, then three characters.",
  );

const page = z.number().int().min(0).optional().describe("Zero-based page number. Defaults to 0.");
const size = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .optional()
  .describe(`Results per page, 1-${MAX_PAGE_SIZE}. Defaults to ${DEFAULT_PAGE_SIZE}.`);

/** Lexicographic comparison is exact for YYYY-MM-DD, which the schema has already enforced. */
function assertOrdered(name: string, from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) {
    throw new InvalidInputError(`${name}From (${from}) is after ${name}To (${to}).`);
  }
}

interface Coverage {
  issuedFrom: string | null;
  issuedTo: string | null;
  note?: string;
  [key: string]: unknown;
}

/**
 * The envelope both search tools return. Issuer names are cached separately
 * from the search itself, so a body's name is fetched once a day no matter how
 * many different searches surface it.
 */
async function presentSearch(result: SearchResult, coverage: Coverage, context: ToolContext) {
  const organizations = await resolveOrganizations(
    result.decisions.map((decision) => decision.organization.id),
    context.cache,
    context.signal,
  );

  return {
    total: result.info.total,
    page: result.info.page,
    size: result.info.size,
    returned: result.decisions.length,
    hasMore: (result.info.page + 1) * result.info.size < result.info.total,
    coverage,
    // The Lucene query upstream actually ran, including any defaults it
    // applied on its own. Makes a surprising result diagnosable.
    upstreamQuery: result.info.query,
    decisions: attachOrganizations(result.decisions, organizations),
  };
}

/** The note to attach when upstream searched less than was asked for. */
function truncationNote(searched: DayWindow): string {
  return (
    `Διαύγεια caps a search at ${MAX_WINDOW_DAYS} days of issue dates, so only ${searched.from} to ${searched.to} was searched — not the range requested. ` +
    `To cover the rest, search again from ${addDays(searched.to, 1)}.`
  );
}

export const searchDecisionsTool = defineTool({
  name: "search_decisions",
  title: "Search Διαύγεια decisions",
  description:
    "Search the Greek transparency register of administrative acts. Returns matching decisions with their ΑΔΑ, subject, issuing body, declared expenditure and a link to the signed PDF. " +
    "Filters combine with AND. Use `text` for a free-text search across the whole record and `subject` to match only the act's subject line. " +
    `IMPORTANT: Διαύγεια searches at most ${MAX_WINDOW_DAYS} days of issue dates per call. With no date range it searches the last six months; with a longer range it silently truncates to the first ${MAX_WINDOW_DAYS} days from \`issuedFrom\`. ` +
    "To cover a longer period, repeat the search over consecutive windows and read `coverage` to see what each call actually searched — `coverage.note` says where to continue. The archive goes back to 2010. " +
    "Call `list_decision_types` first if you need a valid `decisionType` code, and `search_organizations` to turn a body's name into an `organizationId`. " +
    "For OR between values, several bodies or types at once, or type-specific fields, use search_decisions_advanced. " +
    "This searches act metadata, not the text inside the PDFs.",
  inputSchema: {
    text: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Free-text search across the whole record, including the subject and the issuing body."),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Match only against the act's subject line. Narrower and more precise than `text`."),
    protocolNumber: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe(
        "The body's own reference number for the act (αριθμός πρωτοκόλλου), matched exactly. Bodies number independently, so combine with organizationId.",
      ),
    organizationId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Numeric uid of the issuing body, from search_organizations or `organization.id` on a previous result."),
    unitId: z.string().trim().min(1).optional().describe("Numeric uid of the issuing unit within the body, from list_organization_units."),
    signerId: z.string().trim().min(1).optional().describe("Numeric uid of the signing official."),
    decisionType: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Decision type code such as 'Β.2.2' (payment) or 'Δ.1' (award). Get valid codes from list_decision_types."),
    thematicCategory: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Thematic category code, e.g. '20' for finance. Get valid codes from list_thematic_categories."),
    issuedFrom: isoDate.optional().describe("Earliest issue (signing) date, inclusive. Required to search beyond the last six months."),
    issuedTo: isoDate.optional().describe("Latest issue (signing) date, inclusive."),
    publishedFrom: isoDate
      .optional()
      .describe(
        "Earliest publication date, inclusive — when the act appeared on Διαύγεια, which can be days after it was signed. The issue-date window still applies alongside this.",
      ),
    publishedTo: isoDate.optional().describe("Latest publication date, inclusive."),
    status: z
      .enum(["published", "revoked", "all"])
      .optional()
      .describe(
        "'published' (default) returns only acts currently in force; 'revoked' only acts that have been withdrawn; 'all' both.",
      ),
    page,
    size,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { subject: "προμήθεια", issuedFrom: "2026-01-01", issuedTo: "2026-01-31", size: 5 },
  async handler(input, context) {
    assertOrdered("issued", input.issuedFrom, input.issuedTo);
    assertOrdered("published", input.publishedFrom, input.publishedTo);

    const query = {
      ...input,
      status: input.status ?? "published",
      page: input.page ?? 0,
      size: input.size ?? DEFAULT_PAGE_SIZE,
    };

    const result = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:search_decisions", query),
      context.ttl,
      () => searchDecisions(query, context.signal),
    );

    // What was asked of upstream versus what it searched. They differ whenever
    // the request was wider than the cap, and upstream does not say so itself.
    const requested = issueWindow(input);
    const searched = effectiveWindow(result.info.query, "issueDate");
    const truncated = Boolean(searched && requested && searched.to < requested.to);
    const boundedByPublication = input.publishedFrom !== undefined || input.publishedTo !== undefined;

    const notes: string[] = [];
    if (searched && truncated) {
      notes.push(truncationNote(searched));
    } else if (!requested) {
      notes.push(
        "No issue-date range was given, so only the last six months were searched. Pass issuedFrom to reach older acts; the register starts in 2010.",
      );
    } else if (input.issuedFrom === undefined) {
      notes.push(`Only issuedTo was given, so the ${MAX_WINDOW_DAYS} days ending there were searched.`);
    }
    if (boundedByPublication && !requested) {
      notes.push(
        "publishedFrom/publishedTo limit when acts were published, but the issue-date window above still applies: an act published in this window but signed before it is not included. Pass issuedFrom to widen it.",
      );
    }

    return presentSearch(
      result,
      {
        // The window actually searched, not the one requested. `total` and
        // every page count this range and no more.
        issuedFrom: searched?.from ?? requested?.from ?? null,
        issuedTo: searched?.to ?? requested?.to ?? null,
        requestedFrom: input.issuedFrom ?? null,
        requestedTo: input.issuedTo ?? null,
        publishedFrom: input.publishedFrom ?? null,
        publishedTo: input.publishedTo ?? null,
        status: query.status,
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
      },
      context,
    );
  },
});

export const searchDecisionsAdvancedTool = defineTool({
  name: "search_decisions_advanced",
  title: "Search Διαύγεια decisions with a Lucene query",
  description:
    "Search the register with a Lucene query written by hand, for what the fixed filters of search_decisions cannot express: OR between values, several bodies or types at once, numeric ranges, and the type-specific fields that get_decision_type lists as `searchField`. Returns the same shape as search_decisions. " +
    "Syntax: `field:\"value\"` clauses joined with AND or OR and grouped with parentheses; ranges as `field:[a TO b]` with both bounds given; dates as `DT(YYYY-MM-DDTHH:MM:SS)` in Athens time, e.g. issueDate:[DT(2026-01-01T00:00:00) TO DT(2026-03-31T23:59:59)]. NOT, `-`, wildcards and open ranges (`*`) are rejected. " +
    "Fields: q (whole record), subject, ada, protocolNumber, organizationUid, unitUid, signerUid, decisionTypeUid, thematicCategoryUid, status (\"Αναρτημένη\" in force, \"Ανακληθείσα\" revoked), issueDate, publishTimestamp, documentType, plus per-type fields such as cpv, assignmentType, textFinancialYear, employerOrg and numberOfPeople. " +
    `Two things upstream does on its own: it caps issueDate at ${MAX_WINDOW_DAYS} days from the start of the range (no range means the last six months), and it applies no status filter, so revoked acts are included unless you add status:"Αναρτημένη". ` +
    "`upstreamQuery` shows exactly what ran; a malformed query is rejected with upstream's own message.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .describe('The Lucene query, e.g. (decisionTypeUid:"Δ.1" OR decisionTypeUid:"Δ.2.2") AND cpv:"33600000-6".'),
    page,
    size,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {
    query:
      '(decisionTypeUid:"Δ.1" OR decisionTypeUid:"Δ.2.2") AND organizationUid:"99221912" AND status:"Αναρτημένη" AND issueDate:[DT(2026-01-01T00:00:00) TO DT(2026-06-30T23:59:59)]',
    size: 5,
  },
  async handler(input, context) {
    const currentPage = input.page ?? 0;
    const currentSize = input.size ?? DEFAULT_PAGE_SIZE;

    const result = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:search_decisions_advanced", {
        query: input.query,
        page: currentPage,
        size: currentSize,
      }),
      context.ttl,
      () => runSearch(input.query, currentPage, currentSize, context.signal),
    );

    // The window the caller wrote, if any, against the one upstream ran.
    const requested = effectiveWindow(input.query, "issueDate");
    const searched = effectiveWindow(result.info.query, "issueDate");
    const truncated = Boolean(searched && requested && searched.to < requested.to);

    const notes: string[] = [];
    if (searched && truncated) {
      notes.push(truncationNote(searched));
    } else if (!requested) {
      notes.push(
        "The query has no issueDate range, so upstream added the last six months. Write one — issueDate:[DT(YYYY-MM-DDT00:00:00) TO DT(YYYY-MM-DDT23:59:59)] — to search elsewhere; the register starts in 2010.",
      );
    }
    if (!/\bstatus:/u.test(input.query)) {
      notes.push(
        'The query has no status clause, so revoked acts are included. Add status:"Αναρτημένη" for acts in force only.',
      );
    }

    return presentSearch(
      result,
      {
        issuedFrom: searched?.from ?? requested?.from ?? null,
        issuedTo: searched?.to ?? requested?.to ?? null,
        requestedFrom: requested?.from ?? null,
        requestedTo: requested?.to ?? null,
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
      },
      context,
    );
  },
});

export const getDecisionTool = defineTool({
  name: "get_decision",
  title: "Get a Διαύγεια decision by ΑΔΑ",
  description:
    "Fetch one published administrative act by its ΑΔΑ (the unique code Διαύγεια assigns on publication, e.g. 9ΓΓ346ΝΨ2Ν-Β5Τ). " +
    "Returns the full record: subject, issuing body, signers, declared expenditure with budget codes, type-specific fields, any attached files, and a link to the signed PDF. " +
    "Use search_decisions when you do not already have an ΑΔΑ, get_decision_text to read what the PDF says, and get_decision_history to see whether the act was corrected or revoked.",
  inputSchema: {
    ada: ADA.describe("The act's ΑΔΑ, e.g. 9ΓΓ346ΝΨ2Ν-Β5Τ."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { ada: "9ΓΓ346ΝΨ2Ν-Β5Τ" },
  async handler(input, context) {
    const decision = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_decision", input.ada),
      context.ttl,
      () => fetchDecision(input.ada, context.signal),
    );

    const organizations = await resolveOrganizations(
      [decision.organization.id],
      context.cache,
      context.signal,
    );

    return attachOrganizations([decision], organizations)[0];
  },
});

/** Enough for a long act in one go, small enough not to swamp a context window. */
const MAX_TEXT_CHARACTERS = 40_000;
const DEFAULT_TEXT_PAGES = 10;
const MAX_TEXT_PAGES = 50;

/** Below this many characters a page, the PDF is a scan and the layer is noise. */
const SCANNED_THRESHOLD_PER_PAGE = 20;

export const getDecisionTextTool = defineTool({
  name: "get_decision_text",
  title: "Read a decision's PDF",
  description:
    "Read the text of the signed PDF behind an act — the decision itself rather than the record around it: the reasoning, the articles, the amounts in the tables, the names. " +
    "search_decisions and get_decision return only metadata; this is the only way to see what an act actually says. " +
    `Text comes back page by page, ${DEFAULT_TEXT_PAGES} pages at a time by default and never more than ${MAX_TEXT_CHARACTERS.toLocaleString("en-US")} characters per call — read \`nextPage\` to continue a long act. ` +
    "A scanned PDF has no text layer and comes back empty with a note saying so; the file itself is always at `documentUrl`.",
  inputSchema: {
    ada: ADA.describe("The act's ΑΔΑ, e.g. ΨΕ1Ψ46ΨΧΞ5-ΝΝΖ."),
    fromPage: z.number().int().min(1).optional().describe("First page to return, 1-based. Defaults to 1."),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(MAX_TEXT_PAGES)
      .optional()
      .describe(`Most pages to return, 1-${MAX_TEXT_PAGES}. Defaults to ${DEFAULT_TEXT_PAGES}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { ada: "ΨΕ1Ψ46ΨΧΞ5-ΝΝΖ", maxPages: 2 },
  async handler(input, context) {
    // The record first: it 404s cleanly where the document endpoint redirects,
    // and it carries the link and the redaction flag the answer should name.
    const decision = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_decision", input.ada),
      context.ttl,
      () => fetchDecision(input.ada, context.signal),
    );

    // The whole text is cached, so paging through a long act costs one fetch.
    const text = await withCache<DecisionText>(
      context.cache,
      cacheKey("gr/diavgeia:decision_text", input.ada),
      context.ttl,
      async () => extractDecisionText(await fetchDecisionDocument(input.ada, context.signal)),
    );

    const fromPage = input.fromPage ?? 1;
    if (fromPage > text.pageCount) {
      throw new InvalidInputError(`fromPage (${fromPage}) is past the last page: the PDF has ${text.pageCount}.`);
    }

    const pages: { page: number; text: string }[] = [];
    let characters = 0;
    let truncated = false;
    const wanted = Math.min(text.pageCount, fromPage - 1 + (input.maxPages ?? DEFAULT_TEXT_PAGES));

    for (let page = fromPage; page <= wanted; page += 1) {
      const body = text.pages[page - 1] ?? "";
      const room = MAX_TEXT_CHARACTERS - characters;
      if (body.length > room) {
        // Cut mid-page rather than drop the page: a caller who asked for it
        // gets its start, and `nextPage` re-reads the rest.
        if (room > 0) pages.push({ page, text: body.slice(0, room) });
        characters += Math.max(room, 0);
        truncated = true;
        break;
      }
      pages.push({ page, text: body });
      characters += body.length;
    }

    const lastReturned = pages.at(-1)?.page ?? fromPage;
    const nextPage = truncated ? lastReturned : lastReturned < text.pageCount ? lastReturned + 1 : null;
    const total = text.pages.reduce((sum, page) => sum + page.length, 0);
    const scanned = total < text.pageCount * SCANNED_THRESHOLD_PER_PAGE;

    return {
      ada: decision.ada,
      subject: decision.subject,
      pageCount: text.pageCount,
      fromPage,
      toPage: lastReturned,
      characters,
      truncated,
      nextPage,
      ...(scanned
        ? {
            note: "This PDF has no text layer — it is a scanned image, so there is nothing to read here. The file itself is at documentUrl.",
          }
        : truncated
          ? {
              note: `Cut at ${MAX_TEXT_CHARACTERS.toLocaleString("en-US")} characters. Call again with fromPage: ${nextPage} for the rest of that page and what follows.`,
            }
          : {}),
      redacted: decision.redacted,
      documentUrl: decision.documentUrl,
      pages,
    };
  },
});

export const getDecisionHistoryTool = defineTool({
  name: "get_decision_history",
  title: "Get a decision's version history",
  description:
    "List every version filed under one ΑΔΑ, oldest first, with when each was filed, its status and the note the body entered. " +
    "This is how to answer 'is this act still in force?', 'was it corrected, and when?' and 'why was it revoked?' — a correction keeps the ΑΔΑ and adds a version; a revocation adds versions in PENDING_REVOCATION and then REVOKED, usually with the reason as the note. " +
    "get_decision returns only the current version.",
  inputSchema: {
    ada: ADA.describe("The act's ΑΔΑ, e.g. 9ΓΓ346ΝΨ2Ν-Β5Τ."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { ada: "630ΜΩ1Ρ-ΤΧΝ" },
  async handler(input, context) {
    // The version log answers an unknown ΑΔΑ with a 500, which would read as
    // an outage. The record itself gives a proper 404, so it is checked first.
    const decision = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_decision", input.ada),
      context.ttl,
      () => fetchDecision(input.ada, context.signal),
    );

    const history = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_decision_history", input.ada),
      context.ttl,
      () => fetchVersionLog(input.ada, context.signal),
    );

    const organizationId = history.organizationId ?? decision.organization.id;
    const organizations = await resolveOrganizations([organizationId], context.cache, context.signal);
    const current = history.versions.at(-1);

    return {
      ada: history.ada,
      organization: organizations.get(organizationId) ?? { id: organizationId, name: null },
      // Read off the log rather than the cached record, so a revocation shows
      // as soon as it is filed.
      status: current?.status ?? decision.status,
      currentVersionId: current?.versionId ?? decision.versionId,
      corrected: history.versions.some((version) => version.correctedVersionId !== null),
      versions: history.versions.map((version) => ({
        ...version,
        current: version.versionId === (current?.versionId ?? decision.versionId),
      })),
      pageUrl: decision.pageUrl,
    };
  },
});

export const listDecisionTypesTool = defineTool({
  name: "list_decision_types",
  title: "List Διαύγεια decision types",
  description:
    "List the controlled vocabulary of decision types, with each code, its Greek label and its parent group. " +
    "These codes are the valid values for the `decisionType` filter on search_decisions — call this first rather than guessing a code. " +
    "get_decision_type explains what an act of one type carries.",
  inputSchema: {
    includeGroups: z
      .boolean()
      .optional()
      .describe(
        "Include the parent grouping nodes that cannot themselves be assigned to an act. Defaults to false.",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async handler(input, context) {
    const all = await loadDecisionTypes(context);

    // Resolved against the full list, so a filtered response still names its
    // parents instead of pointing at codes it omitted.
    const labels = new Map(all.map((type) => [type.uid, type.label]));
    const visible = input.includeGroups ? all : all.filter((type) => type.allowedInDecisions);

    return {
      total: visible.length,
      omittedGroups: input.includeGroups ? 0 : all.length - visible.length,
      types: visible.map((type: RawDecisionType) => ({
        code: type.uid,
        label: type.label,
        parent: type.parent,
        parentLabel: type.parent === null ? null : (labels.get(type.parent) ?? null),
        assignable: type.allowedInDecisions,
      })),
    };
  },
});

/** Shared with get_decision_type, which needs the list to place a type in its group. */
function loadDecisionTypes(context: ToolContext): Promise<RawDecisionType[]> {
  return withCache(
    context.cache,
    cacheKey("gr/diavgeia:list_decision_types", {}),
    context.ttl,
    () => fetchDecisionTypes(context.signal),
  );
}

export const getDecisionTypeTool = defineTool({
  name: "get_decision_type",
  title: "Describe a Διαύγεια decision type",
  description:
    "Describe one decision type: its label, its group, and every field an act of that type carries beyond the common record — the keys that appear in `extraFields` on get_decision, with their meaning, whether they are required, the closed set of values where there is one, and the vocabulary they draw from. " +
    "Each field also names its `searchField`: the Lucene field to use in search_decisions_advanced, or null when the field is not indexed. " +
    "Use it to interpret an act's type-specific data, or to find out what can be filtered on — e.g. that awards (Δ.1) carry `cpv` and `assignmentType`, both searchable, and `awardAmount`, which is not.",
  inputSchema: {
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .describe("Decision type code from list_decision_types, e.g. 'Δ.1' or 'Β.2.2'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { code: "Δ.1" },
  async handler(input, context) {
    const [detail, all] = await Promise.all([
      withCache(
        context.cache,
        cacheKey("gr/diavgeia:get_decision_type", input.code),
        context.ttl,
        () => fetchDecisionTypeDetail(input.code, context.signal),
      ),
      loadDecisionTypes(context),
    ]);

    // The detail endpoint reports no parent for any type; the list does.
    const parent = all.find((type) => type.uid === detail.code)?.parent ?? null;
    const parentLabel = parent === null ? null : (all.find((type) => type.uid === parent)?.label ?? null);

    return {
      code: detail.code,
      label: detail.label,
      parent,
      parentLabel,
      assignable: detail.assignable,
      searchableFields: detail.fields.flatMap((field) => (field.searchField ? [field.searchField] : [])),
      fields: detail.fields,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Register lookups                                                           */
/* -------------------------------------------------------------------------- */

/** Enough to be a name fragment rather than a letter that matches everything. */
const MIN_QUERY_LENGTH = 2;
const MAX_ORGANIZATION_RESULTS = 100;
const DEFAULT_ORGANIZATION_RESULTS = 20;

const organizationId = z
  .string()
  .trim()
  .regex(/^\d+$/, "An organization uid is digits only, e.g. 99221912.")
  .describe("Numeric uid of the body, from `organization.id` on a decision or from search_organizations.");

const unitId = z
  .string()
  .trim()
  .regex(/^\d+$/, "A unit uid is digits only, e.g. 75159.")
  .describe("Numeric uid of the unit, from `unitIds` on a decision or from list_organization_units.");

/**
 * Register labels are shouted and unaccented — "ΝΟΜ.ΓΕΝ. ΝΟΣΟΚΟΜΕΙΟ ΚΑΛΑΜΑΤΑΣ" —
 * while a person types "Καλαμάτας". Uppercasing alone does not close that gap:
 * it leaves the accent on Ά in place. Decomposing first and dropping the
 * combining marks does, and uppercasing afterwards folds the final ς onto Σ for
 * free, so a word typed in either position of a sentence matches.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase();
}

/**
 * Exact name before prefix before substring, then shortest first. Without it
 * "δήμος αθηναίων" answers with a municipal software subsidiary before the
 * municipality itself, simply because it sorts earlier in the register.
 */
function rank(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return 2;
}

export const searchOrganizationsTool = defineTool({
  name: "search_organizations",
  title: "Find a Greek public body",
  description:
    "Find a Greek public body by name or VAT number (ΑΦΜ), and get the numeric uid that search_decisions needs for its `organizationId` filter. " +
    "Matching ignores case and accents, so 'Καλαμάτας', 'καλαματα' and 'ΚΑΛΑΜΑΤΑΣ' are equivalent. " +
    "This is the usual first step when the user names a ministry, municipality or hospital rather than a uid: find the body here, then pass its `id` to search_decisions. " +
    "Covers the roughly 5,400 bodies currently active; `includeInactive` adds the 400 or so that have been dissolved or merged, which still appear as the issuer of older acts.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(MIN_QUERY_LENGTH)
      .max(120)
      .describe(
        "Part of the body's name in Greek, or its VAT number. Accents and case are ignored.",
      ),
    category: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Restrict to one category, e.g. 'MINISTRY', 'NPDD', 'OTA1'. Case-insensitive; search_dictionary with ORG_CATEGORY lists them."),
    includeInactive: z
      .boolean()
      .optional()
      .describe("Include bodies that have been dissolved or merged, and the few pending registration. Defaults to false."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ORGANIZATION_RESULTS)
      .optional()
      .describe(`Most bodies to return, 1-${MAX_ORGANIZATION_RESULTS}. Defaults to ${DEFAULT_ORGANIZATION_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { query: "δήμος αθηναίων", limit: 5 },
  async handler(input, context) {
    // Held since boot and refreshed behind the scenes; see `loadRegister`.
    const register = await loadRegister(context.cache, context.signal);

    const needle = fold(input.query);
    const category = input.category ? input.category.toUpperCase() : null;
    const limit = input.limit ?? DEFAULT_ORGANIZATION_RESULTS;

    const matched: { organization: OrganizationMatch; rank: number; name: string }[] = [];
    for (const organization of register) {
      if (!input.includeInactive && organization.status !== "active") continue;
      if (category && (organization.category ?? "").toUpperCase() !== category) continue;

      const name = fold(organization.name);
      const abbreviation = organization.abbreviation ? fold(organization.abbreviation) : "";
      // A VAT number is matched whole: a substring of one is not a weaker
      // match, it is a different taxpayer.
      const byVat = organization.vatNumber === input.query.trim();

      if (!byVat && !name.includes(needle) && !abbreviation.includes(needle)) continue;
      matched.push({ organization, rank: byVat ? 0 : rank(name, needle), name });
    }

    matched.sort(
      (a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name),
    );

    return {
      query: input.query,
      total: matched.length,
      returned: Math.min(matched.length, limit),
      hasMore: matched.length > limit,
      organizations: matched.slice(0, limit).map((entry) => entry.organization),
    };
  },
});

export const getOrganizationTool = defineTool({
  name: "get_organization",
  title: "Get a Greek public body",
  description:
    "Fetch the full register record of one public body by its numeric uid: official name, VAT number, category, website, the body that supervises it and the Government Gazette issue that established it. " +
    "Use search_organizations when you have a name rather than a uid.",
  inputSchema: {
    organizationId: organizationId.describe("Numeric uid of the body, e.g. 99221912."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "99221912" },
  async handler(input, context) {
    return withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_organization", input.organizationId),
      context.ttl,
      () => fetchOrganizationDetail(input.organizationId, context.signal),
    );
  },
});

/**
 * A body's unit list, on the day-long register cache. Shared by the tools
 * that label a unit uid — the units tool, the signer tools — so the list is
 * fetched once per body however it is reached.
 */
function loadUnits(id: string, context: ToolContext): Promise<OrganizationUnit[]> {
  return withCache(
    context.cache,
    cacheKey("gr/diavgeia:list_organization_units", id),
    REGISTER_TTL_SECONDS,
    () => fetchOrganizationUnits(id, context.signal),
  );
}

/**
 * Upstream answers an unknown numeric uid with an empty list on the per-body
 * endpoints, not a 404 — so an empty list is checked against the register
 * before it is reported as "this body has none".
 */
async function requireOrganization(id: string, context: ToolContext): Promise<Organization> {
  const organizations = await resolveOrganizations([id], context.cache, context.signal);
  const organization = organizations.get(id);
  if (!organization) {
    throw new NotFoundError(
      `No public body is registered under uid "${id}". Search for it by name with search_organizations.`,
      { details: { uid: id } },
    );
  }
  return organization;
}

export const listOrganizationUnitsTool = defineTool({
  name: "list_organization_units",
  title: "List a body's units",
  description:
    "List the departments, directorates and branches of one public body, with the uid of each. " +
    "These uids are the valid values for the `unitId` filter on search_decisions, which narrows a search from a whole ministry to one directorate inside it. " +
    "Units nest: `parentId` points at the containing unit, or at the body itself for a top-level one. " +
    "Defunct units are excluded unless `includeInactive` is set — they still appear on the older acts they signed.",
  inputSchema: {
    organizationId: organizationId.describe("Numeric uid of the body whose units to list."),
    includeInactive: z
      .boolean()
      .optional()
      .describe("Include units that have been dissolved or merged. Defaults to false."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "99221912" },
  async handler(input, context) {
    const all = await loadUnits(input.organizationId, context);
    const organization =
      all.length === 0
        ? await requireOrganization(input.organizationId, context)
        : (await resolveOrganizations([input.organizationId], context.cache, context.signal)).get(
            input.organizationId,
          );

    // Resolved against the full list, so a filtered response still names the
    // parents of what it returns instead of pointing at units it omitted. A
    // top-level unit's parent is the body itself, so that is labelled too.
    const labels = new Map(all.map((unit) => [unit.id, unit.label]));
    if (organization) labels.set(organization.id, organization.name);
    const visible = input.includeInactive ? all : all.filter((unit) => unit.active);

    return {
      organizationId: input.organizationId,
      total: visible.length,
      omittedInactive: input.includeInactive ? 0 : all.length - visible.length,
      units: visible.map((unit) => ({
        ...unit,
        parentLabel: unit.parentId === null ? null : (labels.get(unit.parentId) ?? null),
      })),
    };
  },
});

export const getUnitTool = defineTool({
  name: "get_unit",
  title: "Get a unit by uid",
  description:
    "Resolve the uid of a unit — a department, directorate or branch — into its name, category, active dates and what it sits inside, without knowing which body it belongs to. " +
    "Decisions carry only `unitIds`; this is how to name the office that issued one. " +
    "`parent` is the containing unit, or the body itself for a top-level unit. Use list_organization_units to see a body's whole structure.",
  inputSchema: {
    unitId: unitId.describe("Numeric uid of the unit, e.g. 75159."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { unitId: "75159" },
  async handler(input, context) {
    const unit = await loadUnit(input.unitId, context);
    return { ...unit, parent: await resolveParent(unit.parentId, context) };
  },
});

function loadUnit(id: string, context: ToolContext): Promise<OrganizationUnit> {
  return withCache(
    context.cache,
    cacheKey("gr/diavgeia:get_unit", id),
    REGISTER_TTL_SECONDS,
    () => fetchUnit(id, context.signal),
  );
}

/**
 * A unit's parent is either another unit or the body itself, and nothing in
 * the record says which. The unit endpoint is tried first; a 404 there means
 * the uid is a body's.
 */
async function resolveParent(
  parentId: string | null,
  context: ToolContext,
): Promise<{ id: string; label: string | null; kind: "unit" | "organization" | "unknown" } | null> {
  if (parentId === null) return null;

  try {
    const unit = await loadUnit(parentId, context);
    return { id: parentId, label: unit.label, kind: "unit" };
  } catch (error) {
    if (!isAgoraError(error) || error.code !== "not_found") throw error;
  }

  const organizations = await resolveOrganizations([parentId], context.cache, context.signal);
  const organization = organizations.get(parentId);
  return organization
    ? { id: parentId, label: organization.name, kind: "organization" }
    : { id: parentId, label: null, kind: "unknown" };
}

/**
 * Fills in the unit each posting names, from the body's own unit list. A
 * posting on the body's uid rather than a unit's is the top-level one.
 */
function labelPostings(
  signer: Signer,
  units: readonly OrganizationUnit[],
  organization: Organization | undefined,
): Signer {
  const labels = new Map(units.map((unit) => [unit.id, unit.label]));
  return {
    ...signer,
    postings: signer.postings.map((posting) => ({
      ...posting,
      unitLabel:
        posting.unitId === signer.organizationId
          ? (organization?.name ?? null)
          : (labels.get(posting.unitId) ?? null),
    })),
  };
}

export const listOrganizationSignersTool = defineTool({
  name: "list_organization_signers",
  title: "List who signs for a body",
  description:
    "List the officials registered to sign acts for one public body: name, the posts they hold and in which units, and whether they may sign for the body as a whole rather than for one unit. " +
    "This answers 'who runs this hospital?' or 'who can sign for the ministry?' — the head of a body is the signer with `canSignForOrganization` and a top-level posting, listed first. " +
    "Each `id` is a valid `signerId` filter on search_decisions. Officials who have left are excluded unless `includeInactive` is set; they still appear on the acts they signed.",
  inputSchema: {
    organizationId: organizationId.describe("Numeric uid of the body whose signers to list."),
    includeInactive: z
      .boolean()
      .optional()
      .describe("Include officials whose signing rights have ended. Defaults to false."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "99221912" },
  async handler(input, context) {
    const all = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:list_organization_signers", input.organizationId),
      context.ttl,
      () => fetchOrganizationSigners(input.organizationId, context.signal),
    );
    if (all.length === 0) await requireOrganization(input.organizationId, context);

    const [organizations, units] = await Promise.all([
      resolveOrganizations([input.organizationId], context.cache, context.signal),
      loadUnits(input.organizationId, context),
    ]);
    const organization = organizations.get(input.organizationId);

    const visible = (input.includeInactive ? all : all.filter((signer) => signer.active))
      .map((signer) => labelPostings(signer, units, organization))
      // Whoever binds the whole body first, then by name — so the head of the
      // body is at the top rather than wherever the register happens to put them.
      .sort(
        (a, b) =>
          Number(b.canSignForOrganization) - Number(a.canSignForOrganization) ||
          (a.lastName ?? "").localeCompare(b.lastName ?? "") ||
          (a.firstName ?? "").localeCompare(b.firstName ?? ""),
      );

    return {
      organization: organization ?? { id: input.organizationId, name: null },
      total: visible.length,
      omittedInactive: input.includeInactive ? 0 : all.length - visible.length,
      signers: visible,
    };
  },
});

export const getSignerTool = defineTool({
  name: "get_signer",
  title: "Get a Διαύγεια signer",
  description:
    "Resolve the uid of an official who signed an act into a person: name, the body they belong to, the posts they hold and in which units. " +
    "Decisions carry only `signerIds`, which say nothing on their own — this is how to answer 'who signed this?'. " +
    "The uid is also a valid `signerId` filter on search_decisions, so this doubles as the way to check whose acts you are about to list. " +
    "list_organization_signers goes the other way, from a body to everyone who signs for it.",
  inputSchema: {
    signerId: z
      .string()
      .trim()
      .regex(/^\d+$/, "A signer uid is digits only, e.g. 100090423.")
      .describe("Numeric uid from `signerIds` on a decision."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { signerId: "100090423" },
  async handler(input, context) {
    const signer = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_signer", input.signerId),
      context.ttl,
      () => fetchSigner(input.signerId, context.signal),
    );

    if (!signer.organizationId) return { ...signer, organization: null };

    // Same day-long cache the searches fill, so this is usually already warm.
    const [organizations, units] = await Promise.all([
      resolveOrganizations([signer.organizationId], context.cache, context.signal),
      loadUnits(signer.organizationId, context),
    ]);
    const organization = organizations.get(signer.organizationId);

    return {
      ...labelPostings(signer, units, organization),
      organization: organization ?? { id: signer.organizationId, name: null },
    };
  },
});

const MAX_POSITION_RESULTS = 300;
const DEFAULT_POSITION_RESULTS = 50;

export const listPositionsTool = defineTool({
  name: "list_positions",
  title: "List position titles",
  description:
    "List the position titles the register knows — Υπουργός, Διοικητής, Προϊστάμενος Τμήματος — either the roughly 230 used anywhere in the state, or only the ones one body uses. " +
    "`positionId` on a signer's postings refers to these, as does the `position` field on acts appointing secretaries-general (type 100). " +
    "Mostly a lookup for a code or a title you have been given; the signer tools already carry the title alongside the code.",
  inputSchema: {
    organizationId: organizationId
      .optional()
      .describe("Only the titles this body uses. Omit for every title in the state."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("A code such as 'POS_10017', or part of a title. Accents and case are ignored."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_POSITION_RESULTS)
      .optional()
      .describe(`Most titles to return, 1-${MAX_POSITION_RESULTS}. Defaults to ${DEFAULT_POSITION_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "99221912" },
  async handler(input, context) {
    const all: Position[] = input.organizationId
      ? await withCache(
          context.cache,
          cacheKey("gr/diavgeia:organization_positions", input.organizationId),
          context.ttl,
          () => fetchOrganizationPositions(input.organizationId ?? "", context.signal),
        )
      : await withCache(
          context.cache,
          cacheKey("gr/diavgeia:positions", {}),
          context.ttl,
          () => fetchPositions(context.signal),
        );

    const needle = input.query === undefined ? null : fold(input.query);
    const limit = input.limit ?? DEFAULT_POSITION_RESULTS;

    const matched: { position: Position; rank: number }[] = [];
    for (const position of all) {
      if (needle === null) {
        matched.push({ position, rank: 0 });
        continue;
      }
      const code = fold(position.id);
      const label = fold(position.label);
      if (code === needle) matched.push({ position, rank: 0 });
      else if (label.includes(needle)) matched.push({ position, rank: 1 + rank(label, needle) });
    }

    matched.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.position.label.length - b.position.label.length ||
        a.position.label.localeCompare(b.position.label),
    );

    return {
      organizationId: input.organizationId ?? null,
      query: input.query ?? null,
      total: matched.length,
      returned: Math.min(matched.length, limit),
      hasMore: matched.length > limit,
      positions: matched.slice(0, limit).map(({ position }) => position),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Vocabularies                                                               */
/* -------------------------------------------------------------------------- */

/** Upstream's dictionary uid for thematic categories. */
const THEMATIC_DICTIONARY = "THK";

const MAX_DICTIONARY_RESULTS = 500;
const DEFAULT_DICTIONARY_RESULTS = 50;

/** One vocabulary, on the day-long cache, however it is reached. */
function loadDictionary(name: string, context: ToolContext): Promise<DictionaryEntry[]> {
  return withCache(
    context.cache,
    cacheKey("gr/diavgeia:dictionary", name),
    REGISTER_TTL_SECONDS,
    () => fetchDictionary(name, context.signal),
  );
}

export const listThematicCategoriesTool = defineTool({
  name: "list_thematic_categories",
  title: "List Διαύγεια thematic categories",
  description:
    "List the controlled vocabulary of thematic categories — the broad subject areas an act can be filed under, such as finance, public health or education. " +
    "These codes are the valid values for the `thematicCategory` filter on search_decisions; call this rather than guessing one. " +
    "A thematic category says what an act is about, where a decision type says what kind of act it is — the two filters are independent and combine.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async handler(_input, context) {
    const entries = await loadDictionary(THEMATIC_DICTIONARY, context);
    return { total: entries.length, categories: entries };
  },
});

export const listDictionariesTool = defineTool({
  name: "list_dictionaries",
  title: "List Διαύγεια vocabularies",
  description:
    "List the controlled vocabularies Διαύγεια publishes — CPV procurement codes, organisation categories, Government Gazette issue types, the Kallikratis regions and municipalities, currencies, revocation reasons and the rest — with the code search_dictionary takes for each. " +
    "Call it to find out which vocabulary a code you have been given belongs to.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async handler(_input, context) {
    const dictionaries = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:list_dictionaries", {}),
      context.ttl,
      () => fetchDictionaries(context.signal),
    );
    return { total: dictionaries.length, dictionaries };
  },
});

/** Exact code first, then a code prefix, then the label the way bodies are ranked. */
function rankEntry(entry: DictionaryEntry, needle: string): number | null {
  const code = fold(entry.code);
  const label = fold(entry.label);
  if (code === needle) return 0;
  if (code.startsWith(needle)) return 1;
  if (label.includes(needle)) return 2 + rank(label, needle);
  if (code.includes(needle)) return 5;
  return null;
}

export const searchDictionaryTool = defineTool({
  name: "search_dictionary",
  title: "Look up a Διαύγεια vocabulary",
  description:
    "Look up entries in one of Διαύγεια's controlled vocabularies by code or by part of a label: what CPV code 33600000-6 means, which ORG_CATEGORY codes exist, or which municipalities ADMIN_STRUCTURE_KALLIKRATIS places in a region. " +
    "Codes from these vocabularies appear in `extraFields` on decisions (cpv, kanonistikipraxitype, …) and in the register (organisation categories, FEK issue types); get_decision_type says which vocabulary a field uses. " +
    "Matching ignores case and accents. With no `query` the vocabulary is listed from the start — fine for the small ones, but CPV has 10,357 entries, so search it.",
  inputSchema: {
    dictionary: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .describe("Vocabulary code from list_dictionaries, e.g. 'CPV', 'ORG_CATEGORY', 'FEKTYPES', 'ADMIN_STRUCTURE_KALLIKRATIS'. Case-insensitive."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("A code, or part of a label. Accents and case are ignored."),
    parent: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Only entries filed under this parent code — e.g. a region's code in ADMIN_STRUCTURE_KALLIKRATIS lists its municipalities. Most vocabularies are flat."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_DICTIONARY_RESULTS)
      .optional()
      .describe(`Most entries to return, 1-${MAX_DICTIONARY_RESULTS}. Defaults to ${DEFAULT_DICTIONARY_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { dictionary: "CPV", query: "φάρμακα", limit: 5 },
  async handler(input, context) {
    const name = input.dictionary.toUpperCase();
    const [entries, dictionaries] = await Promise.all([
      loadDictionary(name, context),
      withCache(
        context.cache,
        cacheKey("gr/diavgeia:list_dictionaries", {}),
        context.ttl,
        () => fetchDictionaries(context.signal),
      ),
    ]);

    const labels = new Map(entries.map((entry) => [entry.code, entry.label]));
    const needle = input.query === undefined ? null : fold(input.query);
    const limit = input.limit ?? DEFAULT_DICTIONARY_RESULTS;

    const matched: { entry: DictionaryEntry; rank: number; order: number }[] = [];
    entries.forEach((entry, order) => {
      if (input.parent !== undefined && entry.parent !== input.parent) return;
      // Without a query, upstream's own order is kept: CPV is hierarchical by
      // code, and the regions list groups municipalities under their region.
      const score = needle === null ? 0 : rankEntry(entry, needle);
      if (score !== null) matched.push({ entry, rank: score, order });
    });

    matched.sort(
      (a, b) =>
        a.rank - b.rank || a.entry.label.length - b.entry.label.length || a.order - b.order,
    );

    return {
      dictionary: name,
      label: dictionaries.find((dictionary) => dictionary.code === name)?.label ?? null,
      query: input.query ?? null,
      parent: input.parent ?? null,
      total: matched.length,
      returned: Math.min(matched.length, limit),
      hasMore: matched.length > limit,
      entries: matched.slice(0, limit).map(({ entry }) => ({
        ...entry,
        parentLabel: entry.parent === null ? null : (labels.get(entry.parent) ?? null),
      })),
    };
  },
});

export const tools = [
  searchDecisionsTool,
  searchDecisionsAdvancedTool,
  getDecisionTool,
  getDecisionTextTool,
  getDecisionHistoryTool,
  listDecisionTypesTool,
  getDecisionTypeTool,
  searchOrganizationsTool,
  getOrganizationTool,
  listOrganizationUnitsTool,
  getUnitTool,
  listOrganizationSignersTool,
  getSignerTool,
  listPositionsTool,
  listThematicCategoriesTool,
  listDictionariesTool,
  searchDictionaryTool,
];
