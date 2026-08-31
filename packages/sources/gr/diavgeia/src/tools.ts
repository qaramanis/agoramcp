import { cacheKey, defineTool, withCache } from "@agoramcp/core";
import { z } from "zod";
import {
  attachOrganizations,
  fetchDecision,
  fetchDecisionTypes,
  effectiveIssueWindow,
  fetchDictionary,
  fetchOrganizationDetail,
  fetchOrganizationRegister,
  fetchOrganizationUnits,
  fetchSigner,
  resolveOrganizations,
  searchDecisions,
  type OrganizationMatch,
  type RawDecisionType,
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

export const searchDecisionsTool = defineTool({
  name: "search_decisions",
  title: "Search Διαύγεια decisions",
  description:
    "Search the Greek transparency register of administrative acts. Returns matching decisions with their ΑΔΑ, subject, issuing body, declared expenditure and a link to the signed PDF. " +
    "Filters combine with AND. Use `text` for a free-text search across the whole record and `subject` to match only the act's subject line. " +
    "IMPORTANT: Διαύγεια searches at most six months of issue dates per call. With no date range it searches the last six months; with a longer range it silently truncates to the first six months from `issuedFrom`. " +
    "To cover a longer period, repeat the search over consecutive six-month windows and read `coverage` to see what each call actually searched. The archive goes back to 2010. " +
    "Call `list_decision_types` first if you need a valid `decisionType` code. " +
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
    organizationId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Numeric uid of the issuing body, as returned in `organization.id` by a previous search."),
    unitId: z.string().trim().min(1).optional().describe("Numeric uid of the issuing unit within the body."),
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
      .describe("Thematic category uid, e.g. '20' for finance."),
    issuedFrom: isoDate.optional().describe("Earliest issue date, inclusive. Required to search beyond the last six months."),
    issuedTo: isoDate.optional().describe("Latest issue date, inclusive."),
    includeRevoked: z
      .boolean()
      .optional()
      .describe("Include revoked and superseded acts. Defaults to false, which returns only acts currently in force."),
    page: z.number().int().min(0).optional().describe("Zero-based page number. Defaults to 0."),
    size: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .optional()
      .describe(`Results per page, 1-${MAX_PAGE_SIZE}. Defaults to ${DEFAULT_PAGE_SIZE}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async handler(input, context) {
    if (input.issuedFrom && input.issuedTo && input.issuedFrom > input.issuedTo) {
      // Lexicographic comparison is exact for YYYY-MM-DD, which the schema
      // has already enforced.
      throw new Error(`issuedFrom (${input.issuedFrom}) is after issuedTo (${input.issuedTo}).`);
    }

    const page = input.page ?? 0;
    const size = input.size ?? DEFAULT_PAGE_SIZE;
    const query = { ...input, page, size };

    const result = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:search_decisions", query),
      context.ttl,
      () => searchDecisions(query, context.signal),
    );

    // Cached separately from the search itself, so a body's name is fetched
    // once a day no matter how many different searches surface it.
    const organizations = await resolveOrganizations(
      result.decisions.map((decision) => decision.organization.id),
      context.cache,
      context.signal,
    );

    const boundedWindow = Boolean(input.issuedFrom ?? input.issuedTo);
    // What upstream searched, which is not always what was asked for.
    const searched = effectiveIssueWindow(result.info.query);
    const truncated = Boolean(
      searched && input.issuedFrom && input.issuedTo && searched.to < input.issuedTo,
    );

    return {
      total: result.info.total,
      page: result.info.page,
      size: result.info.size,
      returned: result.decisions.length,
      hasMore: (result.info.page + 1) * result.info.size < result.info.total,
      coverage: {
        // The window actually searched, not the one requested. `total` and
        // every page below count this range and no more.
        issuedFrom: searched?.from ?? input.issuedFrom ?? null,
        issuedTo: searched?.to ?? input.issuedTo ?? null,
        requestedFrom: input.issuedFrom ?? null,
        requestedTo: input.issuedTo ?? null,
        ...(truncated
          ? {
              note: `Διαύγεια caps a search at six months of issue dates, so only ${searched?.from} to ${searched?.to} was searched — not the range requested. To cover the rest, repeat the search over consecutive six-month windows.`,
            }
          : boundedWindow
            ? {}
            : {
                note: "No date range was given, so only the last six months were searched. Pass issuedFrom to reach older acts; the register starts in 2010.",
              }),
      },
      // The Lucene query upstream actually ran, including any defaults it
      // applied on its own. Makes a surprising result diagnosable.
      upstreamQuery: result.info.query,
      decisions: attachOrganizations(result.decisions, organizations),
    };
  },
});

export const getDecisionTool = defineTool({
  name: "get_decision",
  title: "Get a Διαύγεια decision by ΑΔΑ",
  description:
    "Fetch one published administrative act by its ΑΔΑ (the unique code Διαύγεια assigns on publication, e.g. 9ΓΓ346ΝΨ2Ν-Β5Τ). " +
    "Returns the full record: subject, issuing body, signers, declared expenditure with budget codes, type-specific fields, and a link to the signed PDF. " +
    "Use search_decisions when you do not already have an ΑΔΑ.",
  inputSchema: {
    ada: ADA.describe("The act's ΑΔΑ, e.g. 9ΓΓ346ΝΨ2Ν-Β5Τ."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
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

export const listDecisionTypesTool = defineTool({
  name: "list_decision_types",
  title: "List Διαύγεια decision types",
  description:
    "List the controlled vocabulary of decision types, with each code, its Greek label and its parent group. " +
    "These codes are the valid values for the `decisionType` filter on search_decisions — call this first rather than guessing a code.",
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
    const all = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:list_decision_types", {}),
      context.ttl,
      () => fetchDecisionTypes(context.signal),
    );

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
    "Covers the roughly 5,400 bodies currently registered.",
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
      .describe("Restrict to one category, e.g. 'MINISTRY', 'NPDD', 'OTA1'. Case-insensitive."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ORGANIZATION_RESULTS)
      .optional()
      .describe(`Most bodies to return, 1-${MAX_ORGANIZATION_RESULTS}. Defaults to ${DEFAULT_ORGANIZATION_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async handler(input, context) {
    const register = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:organization_register", {}),
      context.ttl,
      () => fetchOrganizationRegister(context.signal),
    );

    const needle = fold(input.query);
    const category = input.category ? input.category.toUpperCase() : null;
    const limit = input.limit ?? DEFAULT_ORGANIZATION_RESULTS;

    const matched: { organization: OrganizationMatch; rank: number; name: string }[] = [];
    for (const organization of register) {
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
  async handler(input, context) {
    return withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_organization", input.organizationId),
      context.ttl,
      () => fetchOrganizationDetail(input.organizationId, context.signal),
    );
  },
});

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
  async handler(input, context) {
    const all = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:list_organization_units", input.organizationId),
      context.ttl,
      () => fetchOrganizationUnits(input.organizationId, context.signal),
    );

    // Resolved against the full list, so a filtered response still names the
    // parents of what it returns instead of pointing at units it omitted.
    const labels = new Map(all.map((unit) => [unit.id, unit.label]));
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

export const getSignerTool = defineTool({
  name: "get_signer",
  title: "Get a Διαύγεια signer",
  description:
    "Resolve the uid of an official who signed an act into a person: name, the body they belong to, the posts they hold and in which units. " +
    "Decisions carry only `signerIds`, which say nothing on their own — this is how to answer 'who signed this?'. " +
    "The uid is also a valid `signerId` filter on search_decisions, so this doubles as the way to check whose acts you are about to list.",
  inputSchema: {
    signerId: z
      .string()
      .trim()
      .regex(/^\d+$/, "A signer uid is digits only, e.g. 100090423.")
      .describe("Numeric uid from `signerIds` on a decision."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  async handler(input, context) {
    const signer = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:get_signer", input.signerId),
      context.ttl,
      () => fetchSigner(input.signerId, context.signal),
    );

    if (!signer.organizationId) return { ...signer, organization: null };

    // Same day-long cache the searches fill, so this is usually already warm.
    const organizations = await resolveOrganizations(
      [signer.organizationId],
      context.cache,
      context.signal,
    );

    return {
      ...signer,
      organization: organizations.get(signer.organizationId) ?? {
        id: signer.organizationId,
        name: null,
      },
    };
  },
});

/** Upstream's dictionary uid for thematic categories. */
const THEMATIC_DICTIONARY = "THK";

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
    const entries = await withCache(
      context.cache,
      cacheKey("gr/diavgeia:list_thematic_categories", {}),
      context.ttl,
      () => fetchDictionary(THEMATIC_DICTIONARY, context.signal),
    );

    return { total: entries.length, categories: entries };
  },
});

export const tools = [
  searchDecisionsTool,
  getDecisionTool,
  listDecisionTypesTool,
  searchOrganizationsTool,
  getOrganizationTool,
  listOrganizationUnitsTool,
  getSignerTool,
  listThematicCategoriesTool,
];
