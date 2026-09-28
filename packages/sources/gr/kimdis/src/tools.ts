import { cacheKey, defineTool, InvalidInputError, NotFoundError, withCache, type ToolContext } from "@agoramcp/core";
import { z } from "zod";
import {
  addDays,
  documentUrl,
  effectiveWindow,
  extractDocumentText,
  fetchAttachment,
  fetchDocument,
  loadRegister,
  MAX_WINDOW_DAYS,
  PAGE_SIZE,
  search,
  typeOfAdam,
  type DocumentText,
  type DocumentType,
  type OrganizationMatch,
  type SearchQuery,
} from "./client.ts";

/* -------------------------------------------------------------------------- */
/* Shared schema pieces                                                       */
/* -------------------------------------------------------------------------- */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Use YYYY-MM-DD.")
  .describe("Calendar date, YYYY-MM-DD.");

/** Two digits of year, the type, nine digits: 26PROC019700906. */
const ADAM_SHAPE = z
  .string()
  .trim()
  .regex(
    /^\d{2}(?:REQ|PROC|SYMV|PAY|AWRD)\d{9}$/iu,
    "An ΑΔΑΜ looks like 26PROC019700906: two digits of year, REQ, PROC, SYMV or PAY, then nine digits.",
  );

const uid = (what: string, example: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/u, `A ${what} uid is digits only, e.g. ${example}.`);

/** The codes upstream takes for the kind of contract, with their labels. */
const CONTRACT_TYPES = {
  "9": "Υπηρεσίες",
  "10": "Έργα",
  "12": "Μελέτες",
  "13": "Προμήθειες",
  "14": "Τεχνικές και λοιπές συναφείς επιστημονικές υπηρεσίες",
} as const;

/**
 * The award procedures, as upstream's own codes. 11 is documented as valid
 * but no notice of the last three months carries it, so it has no label.
 */
const PROCEDURE_TYPES = {
  "1": "Ανοιχτή διαδικασία",
  "2": "Κλειστή διαδικασία",
  "4": "Ανταγωνιστικός διάλογος",
  "6": "Απευθείας ανάθεση",
  "7": "Ανταγωνιστική διαδικασία με διαπραγμάτευση",
  "11": "(documented upstream, unused in recent notices)",
  "12": "Διαπραγμάτευση χωρίς προηγούμενη δημοσίευση",
  "13": "Διαπραγμάτευση με προηγούμενη προκήρυξη διαγωνισμού (αρ. 266 ν. 4412/2016)",
  "18": "Διαδικασία άρθρου 128 ν. 4412/2016",
} as const;

function describeCodes(codes: Record<string, string>): string {
  return Object.entries(codes)
    .map(([code, label]) => `'${code}' ${label}`)
    .join(", ");
}

const contractTypeCodes = Object.keys(CONTRACT_TYPES) as [keyof typeof CONTRACT_TYPES, ...(keyof typeof CONTRACT_TYPES)[]];
const procedureTypeCodes = Object.keys(PROCEDURE_TYPES) as [keyof typeof PROCEDURE_TYPES, ...(keyof typeof PROCEDURE_TYPES)[]];

/** Filters every search takes. Each tool spreads these and adds its own. */
const baseSearchSchema = {
  title: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe("Words from the act's title. Case and accents are ignored; matched as a phrase."),
  organizationId: uid("body", "99221899")
    .optional()
    .describe("Only acts of this body, by its uid from search_organizations — the same uids Διαύγεια uses."),
  signerId: uid("signer", "100049561")
    .optional()
    .describe("Only acts signed by this official, by the uid in `signer.id` on an act."),
  cpv: z
    .string()
    .trim()
    .regex(/^\d{8}-\d$/u, "A CPV code looks like 33600000-6.")
    .optional()
    .describe("Only acts with an item under this CPV code, e.g. '33600000-6' for pharmaceuticals. Exact code, not a prefix."),
  contractType: z
    .enum(contractTypeCodes)
    .optional()
    .describe(`Kind of contract: ${describeCodes(CONTRACT_TYPES)}.`),
  submittedFrom: isoDate
    .optional()
    .describe(`Earliest posting date, inclusive. ΚΗΜΔΗΣ searches at most ${MAX_WINDOW_DAYS} days per call — see \`coverage\`.`),
  submittedTo: isoDate.optional().describe("Latest posting date, inclusive."),
  cancelledFrom: isoDate.optional().describe("Only acts cancelled on or after this date — with cancelledTo, lists cancellations."),
  cancelledTo: isoDate.optional().describe("Only acts cancelled on or before this date."),
  page: z.number().int().min(0).optional().describe(`Zero-based page number. Pages hold ${PAGE_SIZE} acts; defaults to 0.`),
};

/* -------------------------------------------------------------------------- */
/* The shared search                                                          */
/* -------------------------------------------------------------------------- */

type BaseInput = {
  title?: string | undefined;
  organizationId?: string | undefined;
  signerId?: string | undefined;
  cpv?: string | undefined;
  contractType?: string | undefined;
  submittedFrom?: string | undefined;
  submittedTo?: string | undefined;
  cancelledFrom?: string | undefined;
  cancelledTo?: string | undefined;
  page?: number | undefined;
};

/** Lexicographic comparison is exact for YYYY-MM-DD, which the schema has already enforced. */
function assertOrdered(name: string, from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) {
    throw new InvalidInputError(`${name}From (${from}) is after ${name}To (${to}).`);
  }
}

/**
 * Runs one search and wraps it in the envelope every search tool returns.
 * The window actually searched is computed, since upstream neither says what
 * it applied nor errs when it cuts a range down.
 */
async function runSearch(
  type: DocumentType,
  input: BaseInput,
  specific: Partial<SearchQuery>,
  context: ToolContext,
) {
  assertOrdered("submitted", input.submittedFrom, input.submittedTo);
  assertOrdered("cancelled", input.cancelledFrom, input.cancelledTo);

  const query: SearchQuery = {
    type,
    title: input.title,
    organizationId: input.organizationId,
    signerId: input.signerId,
    cpv: input.cpv,
    contractType: input.contractType,
    submittedFrom: input.submittedFrom,
    submittedTo: input.submittedTo,
    cancelledFrom: input.cancelledFrom,
    cancelledTo: input.cancelledTo,
    page: input.page ?? 0,
    ...specific,
  };

  const result = await withCache(
    context.cache,
    cacheKey(`gr/kimdis:search_${type}`, query),
    context.ttl,
    () => search(query, context.signal),
  );

  const window = effectiveWindow(input.submittedFrom, input.submittedTo);
  const notes: string[] = [];
  if (window.truncated) {
    notes.push(
      `ΚΗΜΔΗΣ caps a search at ${MAX_WINDOW_DAYS} days of posting dates and keeps the most recent, so only ${window.from} to ${window.to} was searched — not the range requested. To cover the rest, search again with submittedTo: ${addDays(window.from, -1)}.`,
    );
  } else if (window.defaulted) {
    notes.push(
      `No posting-date range was given, so the last ${MAX_WINDOW_DAYS} days were searched. Pass submittedFrom and submittedTo to reach older acts.`,
    );
  } else if (input.submittedFrom === undefined) {
    notes.push(`Only submittedTo was given, so the ${MAX_WINDOW_DAYS} days ending there were searched.`);
  } else if (input.submittedTo === undefined && window.to !== input.submittedFrom) {
    notes.push(`Only submittedFrom was given, so the ${MAX_WINDOW_DAYS} days from there were searched, ending ${window.to}.`);
  }

  return {
    type,
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
    size: result.size,
    returned: result.documents.length,
    hasMore: result.page + 1 < result.totalPages,
    coverage: {
      // The window actually searched, not the one requested.
      submittedFrom: window.from,
      submittedTo: window.to,
      requestedFrom: input.submittedFrom ?? null,
      requestedTo: input.submittedTo ?? null,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    },
    documents: result.documents,
  };
}

/* -------------------------------------------------------------------------- */
/* The four searches                                                          */
/* -------------------------------------------------------------------------- */

const LIFECYCLE =
  "Every Greek public purchase is posted to ΚΗΜΔΗΣ in four acts, each with an ΑΔΑΜ code: the request (REQ, what a body wants to buy and its budget), the notice (PROC, the tender or invitation to bid), the contract (SYMV, what was signed and for how much) and the payment (PAY, what was paid). ";

const SEARCH_RETURNS =
  `Returns a page of ${PAGE_SIZE} acts, newest posting first, each with its ΑΔΑΜ, title, buying body, amounts, CPV codes and a link to the signed PDF; get_document has the full record and get_document_text reads the PDF. ` +
  "Filters combine with AND. ";

const WINDOW_RULE =
  `IMPORTANT: ΚΗΜΔΗΣ searches at most ${MAX_WINDOW_DAYS} days of posting dates per call — the last ${MAX_WINDOW_DAYS} by default, and the most recent ${MAX_WINDOW_DAYS} of a longer range. Read \`coverage\` for what was searched; its note says where to continue. ` +
  "Amounts cannot be filtered upstream; read `total` on each act instead. " +
  "A query upstream has not seen before over a wide window can take 15-30 s the first time; the same query answers at once afterwards. ";

export const searchRequestsTool = defineTool({
  name: "search_requests",
  title: "Search purchase requests",
  description:
    "Search the requests (πρωτογενή αιτήματα) with which Greek public bodies start a purchase: what they intend to buy, under which CPV codes, for how much, and the approval record that follows. " +
    LIFECYCLE +
    SEARCH_RETURNS +
    "A request is posted twice — once as the request itself and once as its approval — and `kind` picks either or both. " +
    WINDOW_RULE +
    "Use search_organizations to turn a body's name into `organizationId`.",
  inputSchema: {
    ...baseSearchSchema,
    kind: z
      .enum(["initial", "approval", "all"])
      .optional()
      .describe("'initial' the requests themselves, 'approval' their approval records, 'all' (default) both."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "5001", submittedFrom: "2026-08-01", submittedTo: "2026-08-31", kind: "initial" },
  async handler(input, context) {
    return runSearch("request", input, { requestKind: input.kind ?? "all" }, context);
  },
});

export const searchNoticesTool = defineTool({
  name: "search_notices",
  title: "Search tender notices",
  description:
    "Search the notices (προκηρύξεις, διακηρύξεις and προσκλήσεις) by which Greek public bodies invite bids: the tender, its estimated value, the award procedure, the CPV codes and the deadline for offers. " +
    "This is where to answer 'which tenders are open for X?', 'what is the Ministry of Health buying this month?' or 'how much was tender Y estimated at?'. " +
    LIFECYCLE +
    SEARCH_RETURNS +
    WINDOW_RULE +
    "`deadlineFrom`/`deadlineTo` find tenders by when offers are due, which is how to list what is still open. " +
    "Use search_organizations to turn a body's name into `organizationId`.",
  inputSchema: {
    ...baseSearchSchema,
    procedureType: z
      .enum(procedureTypeCodes)
      .optional()
      .describe(`Award procedure: ${describeCodes(PROCEDURE_TYPES)}.`),
    deadlineFrom: isoDate.optional().describe("Only notices whose deadline for offers is on or after this date."),
    deadlineTo: isoDate.optional().describe("Only notices whose deadline for offers is on or before this date."),
    amendmentsOnly: z.boolean().optional().describe("Only notices that amend an earlier notice. Defaults to false."),
    fundingReference: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .optional()
      .describe("Only notices funded under this public-investment programme reference (ΣΑ/ενάριθμος)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "99221899", submittedFrom: "2026-08-01", submittedTo: "2026-08-31" },
  async handler(input, context) {
    assertOrdered("deadline", input.deadlineFrom, input.deadlineTo);
    return runSearch(
      "notice",
      input,
      {
        procedureType: input.procedureType,
        deadlineFrom: input.deadlineFrom,
        deadlineTo: input.deadlineTo,
        amendmentsOnly: input.amendmentsOnly,
        fundingReference: input.fundingReference,
      },
      context,
    );
  },
});

export const searchContractsTool = defineTool({
  name: "search_contracts",
  title: "Search signed contracts",
  description:
    "Search the contracts (συμβάσεις) Greek public bodies have signed: what was bought, from whom it was tendered, the award procedure, the value with and without VAT, the term, and the notice and award that led to it. " +
    "This is where to answer 'what did body X contract for last month?' or 'how much did the contract for Y come to?'. " +
    LIFECYCLE +
    SEARCH_RETURNS +
    WINDOW_RULE +
    "`amendmentsOnly` lists modifications and extensions of earlier contracts. " +
    "Use search_organizations to turn a body's name into `organizationId`.",
  inputSchema: {
    ...baseSearchSchema,
    amendmentsOnly: z.boolean().optional().describe("Only contracts that modify or extend an earlier contract. Defaults to false."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { cpv: "33600000-6", submittedFrom: "2026-08-01", submittedTo: "2026-08-31" },
  async handler(input, context) {
    return runSearch("contract", input, { amendmentsOnly: input.amendmentsOnly }, context);
  },
});

export const searchPaymentsTool = defineTool({
  name: "search_payments",
  title: "Search payment orders",
  description:
    "Search the payment orders (εντολές πληρωμής) Greek public bodies post when money leaves the account: what was paid for, how much with and without VAT, the contract it settles, and the Διαύγεια commitment act behind it. " +
    "This is where to answer 'what has body X actually paid for Y?' — a payment is the last act of a purchase, after the request, the notice and the contract. " +
    LIFECYCLE +
    SEARCH_RETURNS +
    WINDOW_RULE +
    "Use search_organizations to turn a body's name into `organizationId`.",
  inputSchema: {
    ...baseSearchSchema,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { organizationId: "5001", submittedFrom: "2026-08-01", submittedTo: "2026-08-31" },
  async handler(input, context) {
    return runSearch("payment", input, {}, context);
  },
});

/* -------------------------------------------------------------------------- */
/* One act                                                                    */
/* -------------------------------------------------------------------------- */

export const getDocumentTool = defineTool({
  name: "get_document",
  title: "Get an act by ΑΔΑΜ",
  description:
    "Fetch one act by its ΑΔΑΜ — a request (REQ), notice (PROC), contract (SYMV) or payment (PAY) — in full: the buying body, unit and signer, every item with its CPV code, quantity, unit price and VAT, the amounts, the award procedure and legal basis, funding, and `links` to the other acts of the same purchase and to the Διαύγεια acts it cites. " +
    "Follow `links` to walk a purchase from request to payment: a payment names its contract, a contract its notice and award, a notice its approved requests. " +
    "Award decisions (AWRD) are not served by the open-data API. Use the search tools when you do not have an ΑΔΑΜ, and get_document_text to read the signed PDF.",
  inputSchema: {
    adam: ADAM_SHAPE.describe("The act's ΑΔΑΜ, e.g. 26PROC019700906."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { adam: "26PROC019700906" },
  async handler(input, context) {
    return withCache(
      context.cache,
      cacheKey("gr/kimdis:get_document", input.adam.toUpperCase()),
      context.ttl,
      () => fetchDocument(input.adam, context.signal),
    );
  },
});

/** Enough for a long act in one go, small enough not to swamp a context window. */
const MAX_TEXT_CHARACTERS = 40_000;
const DEFAULT_TEXT_PAGES = 10;
const MAX_TEXT_PAGES = 50;

/** Below this many characters a page, the PDF is a scan and the layer is noise. */
const SCANNED_THRESHOLD_PER_PAGE = 20;

export const getDocumentTextTool = defineTool({
  name: "get_document_text",
  title: "Read an act's PDF",
  description:
    "Read the text of the signed PDF behind an act — the tender document itself, the contract as signed, the payment order: the terms, the specifications, the tables of prices. " +
    "The search tools and get_document return the registry's metadata; this is the only way to see what the act actually says. " +
    `Text comes back page by page, ${DEFAULT_TEXT_PAGES} pages at a time by default and never more than ${MAX_TEXT_CHARACTERS.toLocaleString("en-US")} characters per call — read \`nextPage\` to continue a long tender. ` +
    "A scanned PDF has no text layer and comes back empty with a note saying so; the file itself is always at `documentUrl`.",
  inputSchema: {
    adam: ADAM_SHAPE.describe("The act's ΑΔΑΜ, e.g. 26PAY019700903."),
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
  example: { adam: "26PAY019700903", maxPages: 2 },
  async handler(input, context) {
    const adam = input.adam.toUpperCase();
    const type = typeOfAdam(adam);
    if (type === null || type === "award") {
      // Same wording as get_document, from the same place.
      await fetchDocument(adam, context.signal);
      throw new NotFoundError(`No PDF can be read for "${adam}".`);
    }

    // The whole text is cached, so paging through a long act costs one fetch.
    const text = await withCache<DocumentText>(
      context.cache,
      cacheKey("gr/kimdis:document_text", adam),
      context.ttl,
      async () => extractDocumentText(await fetchAttachment(type, adam, context.signal), context.signal),
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
      adam,
      type,
      pageCount: text.pageCount,
      fromPage,
      toPage: lastReturned,
      characters,
      truncated,
      nextPage,
      ...(scanned
        ? { note: "This PDF has no text layer — it is a scanned image, so there is nothing to read here. The file itself is at documentUrl." }
        : truncated
          ? { note: `Cut at ${MAX_TEXT_CHARACTERS.toLocaleString("en-US")} characters. Call again with fromPage: ${nextPage} for the rest of that page and what follows.` }
          : {}),
      documentUrl: documentUrl(type, adam),
      pages,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Bodies                                                                     */
/* -------------------------------------------------------------------------- */

const MIN_QUERY_LENGTH = 2;
const MAX_ORGANIZATION_RESULTS = 100;
const DEFAULT_ORGANIZATION_RESULTS = 20;

/** Register labels are shouted and unaccented; a person types neither way. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase();
}

/** Exact name before prefix before substring, then shortest first. */
function rank(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return 2;
}

export const searchOrganizationsTool = defineTool({
  name: "search_organizations",
  title: "Find a buying body",
  description:
    "Find a Greek public body by name or VAT number (ΑΦΜ) and get the uid the search tools take as `organizationId`. " +
    "ΚΗΜΔΗΣ keys its acts by the state's shared register of bodies — the same uids Διαύγεια uses, so a uid found here also works on Διαύγεια's tools and vice versa. " +
    "Matching ignores case and accents. Covers the roughly 5,400 bodies currently active; `includeInactive` adds those dissolved or merged, which still appear on older acts.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(MIN_QUERY_LENGTH)
      .max(120)
      .describe("Part of the body's name in Greek, or its VAT number. Accents and case are ignored."),
    includeInactive: z
      .boolean()
      .optional()
      .describe("Include bodies that have been dissolved or merged. Defaults to false."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ORGANIZATION_RESULTS)
      .optional()
      .describe(`Most bodies to return, 1-${MAX_ORGANIZATION_RESULTS}. Defaults to ${DEFAULT_ORGANIZATION_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { query: "νοσοκομείο βόλου", limit: 5 },
  async handler(input, context) {
    const register = await loadRegister(context.cache, context.signal);

    const needle = fold(input.query);
    const limit = input.limit ?? DEFAULT_ORGANIZATION_RESULTS;

    const matched: { organization: OrganizationMatch; rank: number; name: string }[] = [];
    for (const organization of register) {
      if (!input.includeInactive && organization.status !== "active") continue;

      const name = fold(organization.name);
      const abbreviation = organization.abbreviation ? fold(organization.abbreviation) : "";
      // A VAT number is matched whole: a substring of one is a different taxpayer.
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

export const tools = [
  searchRequestsTool,
  searchNoticesTool,
  searchContractsTool,
  searchPaymentsTool,
  getDocumentTool,
  getDocumentTextTool,
  searchOrganizationsTool,
];
