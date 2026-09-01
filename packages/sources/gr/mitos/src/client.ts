import {
  cacheKey,
  createHttpClient,
  isAgoraError,
  NotFoundError,
  UpstreamError,
  withCache,
  type Cache,
} from "@agoramcp/core";

/**
 * Two upstreams, one registry. The public API (run by ΕΔΥΤΕ/GRNET) is the
 * documented, stable face of Μίτος: the list of procedures, one procedure in
 * full, the register of bodies. It has no search of any kind — `search`, `q`
 * and `title` on the list are accepted and ignored — so anything that finds a
 * procedure by what it says goes to the registry's own MediaWiki API, which is
 * what the site itself runs on. Both are read-only and need no credential.
 */
export const API_URL = "https://api.digigov.grnet.gr/v1/";
export const WIKI_URL = "https://mitos.gov.gr/";

/** A procedure's permanent address, which upstream also returns as `url`. */
const PROCEDURE_URL_PREFIX = "https://id.mitos.gov.gr/";

/**
 * The wiki page a person reads, by title with the wiki's underscores for
 * spaces; the namespace `ΔΔ` holds the published procedures.
 */
const PROCEDURE_PAGE_PREFIX = "https://mitos.gov.gr/index.php/ΔΔ:";

/** MediaWiki namespace number of `ΔΔ`. The drafts (`ΥΕ`, `ΠΔ`, …) are not public data. */
const PROCEDURE_NAMESPACE = 9002;

const api = createHttpClient({
  baseUrl: API_URL,
  timeoutMs: 20_000,
  retries: 2,
});

const wiki = createHttpClient({
  baseUrl: WIKI_URL,
  timeoutMs: 20_000,
  retries: 2,
});

/* -------------------------------------------------------------------------- */
/* Upstream shapes                                                            */
/* -------------------------------------------------------------------------- */

interface RawTitle {
  el?: string | null;
  en?: string | null;
}

/**
 * How `services-extended` writes a reference to another record: an id with
 * both titles. The plain `services` endpoint writes the bare id instead, and
 * a few fields carry one or the other depending on the editor's entry.
 */
interface RawLabel {
  id: string | number;
  title?: RawTitle | null;
  url?: string | null;
}

type RawRef = RawLabel | string | number | null | undefined;

interface RawListing {
  id: string;
  title?: RawTitle | null;
  ns?: string | null;
  last_updated?: string | null;
}

interface RawPage<T> {
  data?: T[] | null;
  total?: number | null;
  next_page?: number | null;
  current_page?: number | null;
  success?: boolean | null;
}

interface RawProcess {
  official_title?: string | null;
  alternative_titles?: string[] | null;
  description?: string | null;
  remarks?: string | null;
  status?: string | null;
  org_owner?: RawRef;
  org_owner_is_private?: boolean | null;
  provision_org?: RawRef[] | null;
  provision_org_group?: RawRef[] | null;
  provision_org_group_remote?: RawRef[] | null;
  provision_org_owner_directory?: RawRef[] | null;
  provision_org_directory?: string[] | null;
  type?: string | null;
  trigger?: string[] | null;
  trigger_type?: string[] | null;
  usage?: string[] | null;
  output_type?: string[] | null;
  delivery_type?: string[] | null;
  provided_to?: string[] | null;
  tax_type?: string[] | null;
  life_events?: string[] | null;
  deadline_duration?: string | null;
  validity_duration_set?: string | null;
  validity_duration?: string | null;
  estimated_implementation_duration_min?: string | null;
  estimated_implementation_duration_max?: string | null;
  total_duration_steps_min?: string | null;
  total_duration_steps_max?: string | null;
  total_duration_steps_digital_min?: string | null;
  total_duration_steps_digital_max?: string | null;
  cost_min?: number | string | null;
  cost_max?: number | string | null;
  evidence_identification_type?: string[] | null;
  evidence_identification_type_other?: string | null;
  govgr_codes?: RawRef[] | null;
  application_type?: string | null;
  application_description?: string | null;
  application_note?: string | null;
  application_submission_type?: string[] | null;
  application_owner?: string[] | null;
  application_related_url?: string | null;
  border_provision?: string[] | null;
  sdg_codes?: RawRef[] | null;
  sdg_resource?: string | null;
  sdg_resource_other?: string | null;
  sdg_notes?: string | null;
  sdg_lack_of_response_rule?: string | null;
  nace_codes?: RawRef[] | null;
  source?: string[] | null;
  output_registries?: RawRef[] | null;
  see_also?: RawRef[] | null;
  [key: string]: unknown;
}

interface RawCondition {
  conditions_num_id?: number | null;
  conditions_type?: string | null;
  conditions_name?: string | null;
  conditions_url?: string | null;
  conditions_alternative?: boolean | null;
  conditions_alternative_of?: number | null;
}

interface RawEvidence {
  evidence_num_id?: number | null;
  evidence_type?: RawRef;
  evidence_description?: string | null;
  evidence_note?: string | null;
  evidence_owner?: string[] | null;
  evidence_submission_type?: string[] | null;
  evidence_is_under_prerequisite?: boolean | null;
  evidence_prerequisite?: string[] | null;
  evidence_alternative?: boolean | null;
  evidence_alternative_of?: number | null;
  evidence_related_process?: RawRef[] | null;
  evidence_related_url?: string | null;
  registry_evidence_id?: string | null;
}

interface RawFee {
  evidence_cost_num_id?: number | null;
  evidence_cost_type?: string | null;
  evidence_cost_description?: string | null;
  evidence_cost_min?: number | string | null;
  evidence_cost_max?: number | string | null;
  evidence_cost_calculation?: string[] | null;
  evidence_cost_payment_type?: string[] | null;
  evidence_cost_alternative?: boolean | null;
  evidence_cost_code?: string | null;
  evidence_cost_url?: string | null;
}

interface RawStep {
  step_num_id?: number | null;
  step_title?: string | null;
  step_description?: string | null;
  step_note?: string | null;
  step_official?: string | null;
  step_implementation?: string | null;
  step_duration_min?: string | null;
  step_duration_max?: string | null;
  /** A boolean on most records, "t"/"f" on older ones. */
  step_exit?: boolean | string | null;
  step_child?: boolean | string | null;
  step_previous_child?: number | null;
  step_url?: string | null;
}

interface RawDigitalStep {
  step_digital_num_id?: number | null;
  step_digital_title?: string | null;
  step_digital_description?: string | null;
  step_digital_note?: string | null;
  step_digital_official?: string | null;
  step_digital_implementation?: string | null;
  step_digital_duration_min?: string | null;
  step_digital_duration_max?: string | null;
  step_digital_exit?: boolean | string | null;
  step_digital_child?: boolean | string | null;
  step_digital_previous_child?: number | null;
  step_digital_url?: string | null;
  step_digital_co_org?: RawRef;
}

interface RawRule {
  rule_type?: string | null;
  rule_decision_number?: string | null;
  rule_decision_year?: string | null;
  rule_article?: string | null;
  rule_description?: string | null;
  rule_gazette_doc_issue?: string | null;
  rule_gazette_doc_number?: number | string | null;
  /** The act on Διαύγεια, where the rule is a decision published there. */
  rule_ada?: string | null;
  rule_url?: string | null;
}

interface RawUsefulLink {
  useful_link_title?: string | null;
  useful_link_url?: string | null;
}

interface RawDigitalLocation {
  provision_digital_location_title?: string | null;
  provision_digital_location_url?: string | null;
  provision_digital_location_description?: string | null;
}

interface RawGlancePoint {
  title?: string | null;
  url?: string | null;
}

/** The summary box on the wiki page: a label and either a sentence or a list of places. */
interface RawGlanceEntry {
  title?: string | null;
  value?: string | RawGlancePoint[] | null;
}

interface RawGlance {
  service_points?: RawGlanceEntry | null;
  digital_service_points?: RawGlanceEntry | null;
  remote_service_points?: RawGlanceEntry | null;
  evidences?: RawGlanceEntry | null;
  cost?: RawGlanceEntry | null;
  estimated_time?: RawGlanceEntry | null;
  duration_steps_digital?: RawGlanceEntry | null;
  description?: RawGlanceEntry | null;
}

interface RawMetadata {
  process?: RawProcess | null;
  process_conditions?: RawCondition[] | null;
  process_evidences?: RawEvidence[] | null;
  process_evidences_cost?: RawFee[] | null;
  process_rules?: RawRule[] | null;
  process_steps?: RawStep[] | null;
  process_steps_digital?: RawDigitalStep[] | null;
  process_useful_links?: RawUsefulLink[] | null;
  process_provision_digital_locations?: RawDigitalLocation[] | null;
  glance?: RawGlance | null;
}

interface RawProcedure {
  id: string;
  uuid?: string | null;
  url?: string | null;
  ns?: string | null;
  title?: RawTitle | null;
  last_updated?: string | null;
  metadata?: RawMetadata | null;
}

interface RawProcedureResponse {
  data?: RawProcedure | null;
  success?: boolean | null;
}

interface RawOrganization {
  id: string;
  parent_id?: string | null;
  title?: RawTitle | null;
  metadata?: {
    url?: string | null;
    code?: string | null;
    vatId?: string | null;
    status?: string | null;
    description?: string | null;
    mainAddress?: {
      postCode?: string | null;
      fullAddress?: string | null;
    } | null;
    contactPoint?: {
      email?: string | null;
      telephone?: string | null;
    } | null;
    foundationFek?: {
      year?: string | number | null;
      issue?: string | null;
      number?: string | number | null;
    } | null;
    foundationDate?: string | null;
    preferredLabel?: string | null;
    terminationDate?: string | null;
    organizationType?: number | null;
    mainDataUpdateDate?: string | null;
  } | null;
}

interface RawWikiSearchHit {
  ns: number;
  title: string;
  pageid: number;
  snippet?: string | null;
}

interface RawWikiSearchResponse {
  query?: {
    searchinfo?: { totalhits?: number | null } | null;
    search?: RawWikiSearchHit[] | null;
  } | null;
  error?: { code?: string; info?: string } | null;
}

/** A page-typed value in a Semantic MediaWiki printout. */
interface RawAskPage {
  fulltext?: string | null;
  displaytitle?: string | null;
}

interface RawAskResult {
  printouts?: Record<string, unknown[] | undefined> | null;
}

interface RawAskResponse {
  query?: {
    /** A map keyed by page title — or an empty array when nothing matched. */
    results?: Record<string, RawAskResult> | unknown[] | null;
  } | null;
  "query-continue-offset"?: number | null;
  error?: { code?: string; info?: string } | null;
}

/* -------------------------------------------------------------------------- */
/* Normalised shapes                                                          */
/* -------------------------------------------------------------------------- */

/** A row of the procedure list — what a search returns. */
export interface ProcedureListing {
  /** The registration code (ΜΑΚ), e.g. 106576. */
  id: string;
  title: string;
  /** Roughly one procedure in seven has an English title. */
  titleEn: string | null;
  /** When the record was last edited, as an ISO timestamp with the Athens offset. */
  updatedAt: string | null;
  /** Permanent address, `https://id.mitos.gov.gr/{id}`. */
  url: string;
}

/** What the wiki's semantic index knows about a procedure beyond its title. */
export interface ProcedureFacets {
  id: string;
  lifeEvents: string[];
  audiences: string[];
  /** Id of the body that owns the procedure, as the organisation register keys it. */
  ownerId: string | null;
}

export interface WikiHit {
  /** The page title without its `ΔΔ:` namespace prefix — the procedure's list title. */
  title: string;
  pageId: number;
  /** The matching passage, tags stripped. */
  snippet: string | null;
}

export interface WikiSearch {
  totalHits: number;
  hits: WikiHit[];
}

/** A reference to another record: a body, a document type, a gov.gr service. */
export interface Ref {
  id: string;
  name: string | null;
  nameEn: string | null;
}

export interface Link {
  title: string | null;
  url: string | null;
}

/** An ISO 8601 duration as upstream writes it, with a reading of it. */
export interface Duration {
  iso: string;
  text: string;
}

export interface DurationRange {
  min: Duration | null;
  max: Duration | null;
}

export interface Condition {
  n: number | null;
  /** `Διοικητικές`, `Ηλικιακές`, `Κατοχής κωδικών για είσοδο σε λογισμικό`, … */
  type: string | null;
  text: string | null;
  url: string | null;
  /** Satisfies the procedure in place of condition `alternativeOf` rather than alongside it. */
  alternative: boolean;
  alternativeOf: number | null;
}

/** One document the applicant must produce — a δικαιολογητικό. */
export interface RequiredDocument {
  n: number | null;
  /** The document type as the registry classifies it: `Εξουσιοδότηση`, `Ψηφιακό αντίγραφο δελτίου ταυτότητας`, … */
  type: Ref | null;
  description: string | null;
  note: string | null;
  /** Who produces it: the applicant, another body via interoperability, … */
  providedBy: string[];
  /** How it may be submitted: in person, digitally, ex officio, … */
  submission: string[];
  /** Needed only when one of `conditions` of the named types applies. */
  conditional: boolean;
  conditionTypes: string[];
  alternative: boolean;
  alternativeOf: number | null;
  /** Procedures that issue this document, for a caller who does not have it yet. */
  issuedBy: Ref[];
  url: string | null;
}

export interface Fee {
  n: number | null;
  type: string | null;
  description: string | null;
  /** Euros. Equal when the fee is fixed. */
  min: number | null;
  max: number | null;
  calculation: string[];
  paymentTypes: string[];
  alternative: boolean;
  code: string | null;
  url: string | null;
}

export interface Step {
  n: number | null;
  title: string | null;
  description: string | null;
  note: string | null;
  /** Who performs it: the applicant, an official, a piece of software. */
  by: string | null;
  /** How: by hand, through software, a check, … */
  method: string | null;
  duration: DurationRange;
  /** The procedure can end here — a refusal, or an early completion. */
  exit: boolean;
  /** A branch of step `previous`, not a step everyone takes. */
  child: boolean;
  previous: number | null;
  url: string | null;
  /** On a digital step, the other body whose system performs it. */
  coOrganization: Ref | null;
}

export interface LegalRule {
  /** `Νόμος`, `Προεδρικό Διάταγμα`, `Κοινή Υπουργική Απόφαση`, `Ευρωπαϊκός Κανονισμός`, … */
  type: string | null;
  number: string | null;
  year: string | null;
  article: string | null;
  description: string | null;
  /** Government Gazette issue and number, where the rule was published there. */
  gazette: { issue: string | null; number: string | null } | null;
  /** The act's ΑΔΑ on Διαύγεια, where the rule is a decision published there. */
  ada: string | null;
  url: string | null;
}

export interface Procedure {
  id: string;
  url: string;
  /** The page a person reads on mitos.gov.gr. */
  pageUrl: string;
  updatedAt: string | null;
  title: string;
  titleEn: string | null;
  /** The formal name, which may differ from the list title in case or wording. */
  officialTitle: string | null;
  alternativeTitles: string[];
  description: string | null;
  remarks: string | null;
  /** The body responsible for the procedure. */
  owner: Ref | null;
  ownerIsPrivate: boolean;
  /** The directorate within the owner that runs it. */
  ownerDirectorates: Ref[];
  /** Where a person goes: `Δήμοι`, `ΚΕΠ`, a named body. */
  providedBy: Ref[];
  providedByDirectorates: string[];
  /** Where it can be done by video call — `myKEPlive`. */
  providedRemotelyBy: Ref[];
  /** The summary box: named service points with links, in person, online and remote. */
  servicePoints: {
    inPerson: Link[];
    digital: Link[];
    remote: Link[];
  };
  /** The online entry points, usually the gov.gr page. */
  digitalLocations: (Link & { description: string | null })[];
  /** The gov.gr services this procedure is offered as. */
  govgr: (Ref & { url: string | null })[];
  /** Who it is for: `Πολίτες`, `Επιχειρήσεις`, `Δημόσιους Υπαλλήλους`, … */
  audiences: string[];
  lifeEvents: string[];
  /** `Εξωστρεφής` (started by the public) or `Εσωστρεφής` (internal to the administration). */
  type: string | null;
  triggers: string[];
  triggerTypes: string[];
  usage: string[];
  outputTypes: string[];
  deliveryTypes: string[];
  taxTypes: string[];
  cost: {
    /** The summary sentence: `Παρέχεται χωρίς κόστος`, `20 €`, … */
    summary: string | null;
    min: number | null;
    max: number | null;
    fees: Fee[];
  };
  documents: {
    /** The summary: `Δεν απαιτούνται`, `0 έως 1`, `3`, … */
    summary: string | null;
    count: number;
    items: RequiredDocument[];
  };
  /** How the applicant proves who they are: TAXISnet codes, an identity document, … */
  identification: string[];
  duration: {
    /** The summary: `10 λεπτά`, `3 ημέρες`, … */
    summary: string | null;
    digitalSummary: string | null;
    inPerson: DurationRange;
    digital: DurationRange;
    /** How long the body says the whole thing takes, end to end. */
    implementation: DurationRange;
    /** The legal deadline for the body to answer. */
    deadline: Duration | null;
    /** How long the output stays valid. */
    validity: { set: string | null; duration: Duration | null };
  };
  application: {
    type: string | null;
    description: string | null;
    note: string | null;
    submission: string[];
    applicants: string[];
    url: string | null;
  };
  conditions: Condition[];
  /** The in-person route, in order. */
  steps: Step[];
  /** The online route, in order. */
  digitalSteps: Step[];
  legalBasis: LegalRule[];
  usefulLinks: Link[];
  seeAlso: Ref[];
  /** Registries the procedure writes to. */
  outputRegistries: Ref[];
  /** EU Single Digital Gateway data, on procedures offered across borders. */
  crossBorder: {
    provision: string[];
    sdgCodes: Ref[];
    sdgResource: string | null;
    sdgResourceOther: string | null;
    sdgNotes: string | null;
    lackOfResponseRule: string | null;
    naceCodes: Ref[];
    source: string[];
  } | null;
  /**
   * Fields of the record this adapter does not map, verbatim. The API is in
   * beta and its editors add fields; nothing is dropped on the way through.
   */
  extra: Record<string, unknown>;
}

/** A body in the registry of organisations that own and provide procedures. */
export interface Organization {
  id: string;
  name: string;
  nameEn: string | null;
  vatId: string | null;
  parentId: string | null;
  status: string | null;
  address: string | null;
  postCode: string | null;
  email: string | null;
  telephone: string | null;
  website: string | null;
  /** Upstream's numeric type code; no vocabulary is published for it. */
  typeCode: number | null;
  foundedOn: string | null;
  foundingGazette: { issue: string | null; number: string | null; year: string | null } | null;
  terminatedOn: string | null;
  updatedOn: string | null;
}

/* -------------------------------------------------------------------------- */
/* The procedure list                                                         */
/* -------------------------------------------------------------------------- */

/** The list, the facets and the bodies all move on the order of days. */
export const INDEX_TTL_SECONDS = 86_400;

/**
 * Upstream honours any `limit`; 2,000 rows is about 450 KB and well under a
 * second, so the whole register — 4,387 procedures today — is three calls.
 */
const LIST_PAGE_SIZE = 2_000;

/** Every published procedure, in one document. */
export async function fetchProcedureList(signal: AbortSignal): Promise<ProcedureListing[]> {
  const listings: ProcedureListing[] = [];

  for (let page = 1; ; page += 1) {
    const body = await api.getJson<RawPage<RawListing>>("services", {
      query: { page, limit: LIST_PAGE_SIZE },
      signal,
    });

    for (const raw of body.data ?? []) {
      // The API lists only `ΔΔ`, but the point of the check is to stay that
      // way if a draft namespace ever leaks into it.
      if (raw.ns && raw.ns !== "ΔΔ") continue;
      listings.push(toListing(raw));
    }

    if (!body.next_page || (body.data ?? []).length === 0) break;
  }

  return listings;
}

function toListing(raw: RawListing): ProcedureListing {
  return {
    id: String(raw.id),
    title: raw.title?.el?.trim() || `#${raw.id}`,
    titleEn: blankToNull(raw.title?.en),
    updatedAt: blankToNull(raw.last_updated),
    url: `${PROCEDURE_URL_PREFIX}${raw.id}`,
  };
}

const LIST_KEY = cacheKey("gr/mitos:procedure_list", {});

/** The list, from cache when held, otherwise fetched now. Cheap either way. */
export function loadProcedureList(cache: Cache, signal: AbortSignal): Promise<ProcedureListing[]> {
  return withCache(cache, LIST_KEY, INDEX_TTL_SECONDS, () => fetchProcedureList(signal));
}

/* -------------------------------------------------------------------------- */
/* Facets, from the wiki's semantic index                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pages of 500. The response time is not linear in the page size — 500 rows
 * come back in under a second, 1,000 take nearly six — so the register is
 * swept in nine small pages rather than one large one.
 */
const ASK_PAGE_SIZE = 500;

/** Pages fetched at once. Three is quick without leaning on the wiki. */
const ASK_CONCURRENCY = 3;

const ASK_PRINTOUTS = "|?Process id|?Process life events|?Process provided to|?Process org owner";

/**
 * Every procedure's life events, audiences and owner, read from the wiki's
 * semantic index. The public API does not carry these on its list, and
 * reading 4,387 full records to get them is not an option.
 *
 * `expectedTotal` is the length of the API list, which decides the page
 * offsets up front so the pages can be fetched together; a continuation
 * offset on the last page — the wiki has grown since — is followed anyway.
 */
export async function fetchFacets(
  expectedTotal: number,
  signal: AbortSignal,
): Promise<ProcedureFacets[]> {
  const offsets: number[] = [];
  for (let offset = 0; offset < Math.max(expectedTotal, 1); offset += ASK_PAGE_SIZE) {
    offsets.push(offset);
  }

  const pages = await mapConcurrent(offsets, ASK_CONCURRENCY, (offset) => fetchAskPage(offset, signal));

  const facets = new Map<string, ProcedureFacets>();
  for (const page of pages) {
    for (const entry of page.entries) facets.set(entry.id, entry);
  }

  // The wiki may have gained pages since the list was read.
  let next = pages.at(-1)?.continueOffset ?? null;
  while (next !== null) {
    const page = await fetchAskPage(next, signal);
    for (const entry of page.entries) facets.set(entry.id, entry);
    next = page.continueOffset;
  }

  return [...facets.values()];
}

async function fetchAskPage(
  offset: number,
  signal: AbortSignal,
): Promise<{ entries: ProcedureFacets[]; continueOffset: number | null }> {
  const body = await wiki.getJson<RawAskResponse>("api.php", {
    query: {
      action: "ask",
      format: "json",
      query: `[[Process ns::ΔΔ]]${ASK_PRINTOUTS}|limit=${ASK_PAGE_SIZE}|offset=${offset}`,
    },
    signal,
    // 500 rows with four printouts is about 1.5 MB.
    timeoutMs: 60_000,
  });
  if (body.error) throw wikiError(body.error);

  const results = body.query?.results;
  const entries: ProcedureFacets[] = [];

  if (results && !Array.isArray(results)) {
    for (const result of Object.values(results)) {
      const printouts = result.printouts ?? {};
      const id = firstString(printouts["Process id"]);
      if (!id) continue;
      entries.push({
        id,
        lifeEvents: pageNames(printouts["Process life events"]),
        audiences: pageNames(printouts["Process provided to"]),
        ownerId: firstString(printouts["Process org owner"]),
      });
    }
  }

  return {
    entries,
    continueOffset: typeof body["query-continue-offset"] === "number" ? body["query-continue-offset"] : null,
  };
}

/** Printout values of page type carry the page name as `fulltext`. */
function pageNames(values: unknown[] | undefined): string[] {
  const names: string[] = [];
  for (const value of values ?? []) {
    const name =
      typeof value === "string"
        ? value
        : value && typeof value === "object"
          ? ((value as RawAskPage).fulltext ?? (value as RawAskPage).displaytitle ?? null)
          : null;
    const trimmed = name?.trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

function firstString(values: unknown[] | undefined): string | null {
  const value = values?.[0];
  if (typeof value === "string") return blankToNull(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

const FACETS_KEY = cacheKey("gr/mitos:facets", {});

/**
 * Far longer than the facets are trusted for. The point is that they never
 * simply expire: a caller who finds them older than a day gets the copy in
 * hand and triggers a refresh behind them, so the sweep is paid off the
 * request path — at boot by `warm`, and once a day after that. A host with no
 * boot pays it on the first call that filters by a facet, and never again for
 * as long as the instance lives.
 */
const FACETS_HOLD_SECONDS = 7 * 86_400;

interface HeldFacets {
  fetchedAt: number;
  facets: ProcedureFacets[];
}

/** One background refresh at a time, whoever noticed the age first. */
let refreshing: Promise<void> | null = null;

/** The facets keyed by procedure id, from cache when held, otherwise swept now. */
export async function loadFacets(cache: Cache, signal: AbortSignal): Promise<Map<string, ProcedureFacets>> {
  const held = await cache.get<HeldFacets>(FACETS_KEY);
  if (held) {
    if (Date.now() - held.fetchedAt > INDEX_TTL_SECONDS * 1_000) refreshFacets(cache);
    return byId(held.facets);
  }

  const fresh = await withCache(cache, FACETS_KEY, FACETS_HOLD_SECONDS, async () => {
    const listing = await loadProcedureList(cache, signal);
    return { fetchedAt: Date.now(), facets: await fetchFacets(listing.length, signal) };
  });
  return byId(fresh.facets);
}

function byId(facets: readonly ProcedureFacets[]): Map<string, ProcedureFacets> {
  return new Map(facets.map((entry) => [entry.id, entry]));
}

function refreshFacets(cache: Cache): void {
  if (refreshing) return;
  // Its own signal: the request that noticed the age may be long gone.
  const signal = AbortSignal.timeout(180_000);
  refreshing = loadProcedureList(cache, signal)
    .then((listing) => fetchFacets(listing.length, signal))
    .then((facets) => cache.set(FACETS_KEY, { fetchedAt: Date.now(), facets }, FACETS_HOLD_SECONDS))
    // A failed refresh leaves the held copy in place; the next caller tries again.
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
}

/* -------------------------------------------------------------------------- */
/* Full-text search, from the wiki                                            */
/* -------------------------------------------------------------------------- */

/** MediaWiki's own ceiling for a search page. */
export const MAX_WIKI_HITS = 500;

/**
 * Full-text search over the published procedures: titles, descriptions,
 * document lists, step text. Words are ANDed; `intitle:` restricts to titles.
 * Hits come back in the wiki's relevance order with the matching passage.
 */
export async function fetchWikiSearch(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<WikiSearch> {
  const body = await wiki.getJson<RawWikiSearchResponse>("api.php", {
    query: {
      action: "query",
      format: "json",
      list: "search",
      srsearch: query,
      srnamespace: PROCEDURE_NAMESPACE,
      srlimit: Math.min(limit, MAX_WIKI_HITS),
      srprop: "snippet",
    },
    signal,
  });
  if (body.error) throw wikiError(body.error);

  const hits: WikiHit[] = [];
  for (const hit of body.query?.search ?? []) {
    if (hit.ns !== PROCEDURE_NAMESPACE) continue;
    hits.push({
      title: stripNamespace(hit.title),
      pageId: hit.pageid,
      snippet: blankToNull(stripMarkup(hit.snippet ?? "")),
    });
  }

  return { totalHits: body.query?.searchinfo?.totalhits ?? hits.length, hits };
}

function stripNamespace(title: string): string {
  const colon = title.indexOf(":");
  return colon === -1 ? title : title.slice(colon + 1);
}

/** Search snippets arrive as HTML with the matches wrapped in spans. */
function stripMarkup(html: string): string {
  return html
    .replace(/<[^>]+>/gu, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The wiki answers a bad request with 200 and an error envelope. */
function wikiError(error: { code?: string; info?: string }): UpstreamError {
  return new UpstreamError(`mitos.gov.gr rejected the request: ${error.info ?? error.code ?? "unknown error"}`, {
    status: 502,
    details: { code: error.code ?? null },
  });
}

/* -------------------------------------------------------------------------- */
/* One procedure                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The full record, with every reference resolved to a title. `services/{id}`
 * answers in a tenth of a second but writes bare ids for document types,
 * bodies and gov.gr services; `services-extended/{id}` fills them in and
 * costs upstream 1–13 s the first time it assembles a record, a tenth of a
 * second once it has. The result is cached for hours, so the wait is paid
 * once per procedure per instance.
 */
export async function fetchProcedure(id: string, signal: AbortSignal): Promise<Procedure> {
  let body: RawProcedureResponse;
  try {
    body = await api.getJson<RawProcedureResponse>(`services-extended/${encodeURIComponent(id)}`, {
      signal,
      timeoutMs: 60_000,
      // A retry means another cold assembly. One is enough.
      retries: 1,
    });
  } catch (error) {
    if (isAgoraError(error) && error.status === 404) {
      throw new NotFoundError(
        `No procedure is registered under id "${id}". Ids come from search_procedures; the code is also the number in a procedure's id.mitos.gov.gr address.`,
        { details: { id } },
      );
    }
    throw error;
  }

  const raw = body.data;
  if (!raw) {
    throw new NotFoundError(`No procedure is registered under id "${id}".`, { details: { id } });
  }

  return toProcedure(raw);
}

/** Keys of `process` this adapter reads; the rest are handed through as `extra`. */
const MAPPED_PROCESS_KEYS = new Set([
  "official_title", "alternative_titles", "description", "remarks", "status",
  "org_owner", "org_owner_is_private", "provision_org", "provision_org_group",
  "provision_org_group_remote", "provision_org_owner_directory", "provision_org_directory",
  "type", "trigger", "trigger_type", "usage", "output_type", "delivery_type",
  "provided_to", "tax_type", "life_events",
  "deadline_duration", "validity_duration_set", "validity_duration",
  "estimated_implementation_duration_min", "estimated_implementation_duration_max",
  "total_duration_steps_min", "total_duration_steps_max",
  "total_duration_steps_digital_min", "total_duration_steps_digital_max",
  "cost_min", "cost_max",
  "evidence_identification_type", "evidence_identification_type_other",
  "evidence_total_number", "evidence_alternative_total_number",
  "evidence_ex_officio_total_number", "evidence_prerequisite_total_number",
  "evidence_cost_guarantee",
  "govgr_codes",
  "application_type", "application_description", "application_note",
  "application_submission_type", "application_owner", "application_related_url",
  "border_provision", "sdg_codes", "sdg_resource", "sdg_resource_other", "sdg_notes",
  "sdg_lack_of_response_rule", "nace_codes", "source",
  "output_registries", "see_also",
]);

function toProcedure(raw: RawProcedure): Procedure {
  const metadata = raw.metadata ?? {};
  const process = metadata.process ?? {};
  const glance = metadata.glance ?? {};
  const title = raw.title?.el?.trim() || blankToNull(process.official_title) || `#${raw.id}`;

  const documents = (metadata.process_evidences ?? []).map(toDocument);
  const crossBorder = toCrossBorder(process);

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process)) {
    if (!MAPPED_PROCESS_KEYS.has(key) && value !== null && value !== undefined) extra[key] = value;
  }

  return {
    id: String(raw.id),
    url: blankToNull(raw.url) ?? `${PROCEDURE_URL_PREFIX}${raw.id}`,
    pageUrl: `${PROCEDURE_PAGE_PREFIX}${title.replaceAll(" ", "_")}`,
    updatedAt: blankToNull(raw.last_updated),
    title,
    titleEn: blankToNull(raw.title?.en),
    officialTitle: blankToNull(process.official_title),
    alternativeTitles: strings(process.alternative_titles),
    description: blankToNull(process.description),
    remarks: blankToNull(process.remarks),
    owner: ref(process.org_owner),
    ownerIsPrivate: process.org_owner_is_private === true,
    ownerDirectorates: refs(process.provision_org_owner_directory),
    providedBy: [...refs(process.provision_org_group), ...refs(process.provision_org)],
    providedByDirectorates: strings(process.provision_org_directory),
    providedRemotelyBy: refs(process.provision_org_group_remote),
    servicePoints: {
      inPerson: glancePoints(glance.service_points),
      digital: glancePoints(glance.digital_service_points),
      remote: glancePoints(glance.remote_service_points),
    },
    digitalLocations: (metadata.process_provision_digital_locations ?? []).map((location) => ({
      title: blankToNull(location.provision_digital_location_title),
      url: blankToNull(location.provision_digital_location_url),
      description: blankToNull(location.provision_digital_location_description),
    })),
    govgr: (process.govgr_codes ?? []).flatMap((code) => {
      const resolved = ref(code);
      if (!resolved) return [];
      return [{ ...resolved, url: isLabel(code) ? blankToNull(code.url) : null }];
    }),
    audiences: strings(process.provided_to),
    lifeEvents: strings(process.life_events),
    type: blankToNull(process.type),
    triggers: strings(process.trigger),
    triggerTypes: strings(process.trigger_type),
    usage: strings(process.usage),
    outputTypes: strings(process.output_type),
    deliveryTypes: strings(process.delivery_type),
    taxTypes: strings(process.tax_type),
    cost: {
      summary: glanceText(glance.cost),
      min: num(process.cost_min),
      max: num(process.cost_max),
      fees: (metadata.process_evidences_cost ?? []).map(toFee),
    },
    documents: {
      summary: glanceText(glance.evidences),
      count: documents.length,
      items: documents,
    },
    identification: [
      ...strings(process.evidence_identification_type),
      ...(blankToNull(process.evidence_identification_type_other)
        ? [process.evidence_identification_type_other as string]
        : []),
    ],
    duration: {
      summary: glanceText(glance.estimated_time),
      digitalSummary: glanceText(glance.duration_steps_digital),
      inPerson: range(process.total_duration_steps_min, process.total_duration_steps_max),
      digital: range(process.total_duration_steps_digital_min, process.total_duration_steps_digital_max),
      implementation: range(process.estimated_implementation_duration_min, process.estimated_implementation_duration_max),
      deadline: duration(process.deadline_duration),
      validity: {
        set: blankToNull(process.validity_duration_set),
        duration: duration(process.validity_duration),
      },
    },
    application: {
      type: blankToNull(process.application_type),
      description: blankToNull(process.application_description),
      note: blankToNull(process.application_note),
      submission: strings(process.application_submission_type),
      applicants: strings(process.application_owner),
      url: blankToNull(process.application_related_url),
    },
    conditions: (metadata.process_conditions ?? []).map((condition) => ({
      n: num(condition.conditions_num_id),
      type: blankToNull(condition.conditions_type),
      text: blankToNull(condition.conditions_name),
      url: blankToNull(condition.conditions_url),
      alternative: condition.conditions_alternative === true,
      alternativeOf: num(condition.conditions_alternative_of),
    })),
    steps: (metadata.process_steps ?? []).map((step) => ({
      n: num(step.step_num_id),
      title: blankToNull(step.step_title),
      description: blankToNull(step.step_description),
      note: blankToNull(step.step_note),
      by: blankToNull(step.step_official),
      method: blankToNull(step.step_implementation),
      duration: range(step.step_duration_min, step.step_duration_max),
      exit: flag(step.step_exit),
      child: flag(step.step_child),
      previous: num(step.step_previous_child),
      url: blankToNull(step.step_url),
      coOrganization: null,
    })),
    digitalSteps: (metadata.process_steps_digital ?? []).map((step) => ({
      n: num(step.step_digital_num_id),
      title: blankToNull(step.step_digital_title),
      description: blankToNull(step.step_digital_description),
      note: blankToNull(step.step_digital_note),
      by: blankToNull(step.step_digital_official),
      method: blankToNull(step.step_digital_implementation),
      duration: range(step.step_digital_duration_min, step.step_digital_duration_max),
      exit: flag(step.step_digital_exit),
      child: flag(step.step_digital_child),
      previous: num(step.step_digital_previous_child),
      url: blankToNull(step.step_digital_url),
      coOrganization: ref(step.step_digital_co_org),
    })),
    legalBasis: (metadata.process_rules ?? []).map((rule) => {
      const issue = blankToNull(rule.rule_gazette_doc_issue);
      const number = numberText(rule.rule_gazette_doc_number);
      return {
        type: blankToNull(rule.rule_type),
        number: blankToNull(rule.rule_decision_number),
        year: blankToNull(rule.rule_decision_year),
        article: blankToNull(rule.rule_article),
        description: blankToNull(rule.rule_description),
        gazette: issue || number ? { issue, number } : null,
        ada: blankToNull(rule.rule_ada),
        url: blankToNull(rule.rule_url),
      };
    }),
    usefulLinks: (metadata.process_useful_links ?? []).map((link) => ({
      title: blankToNull(link.useful_link_title),
      url: blankToNull(link.useful_link_url),
    })),
    seeAlso: refs(process.see_also),
    outputRegistries: refs(process.output_registries),
    crossBorder,
    extra,
  };
}

function toDocument(raw: RawEvidence): RequiredDocument {
  return {
    n: num(raw.evidence_num_id),
    type: ref(raw.evidence_type),
    description: blankToNull(raw.evidence_description),
    note: blankToNull(raw.evidence_note),
    providedBy: strings(raw.evidence_owner),
    submission: strings(raw.evidence_submission_type),
    conditional: raw.evidence_is_under_prerequisite === true,
    conditionTypes: strings(raw.evidence_prerequisite),
    alternative: raw.evidence_alternative === true,
    alternativeOf: num(raw.evidence_alternative_of),
    issuedBy: refs(raw.evidence_related_process),
    url: blankToNull(raw.evidence_related_url),
  };
}

function toFee(raw: RawFee): Fee {
  return {
    n: num(raw.evidence_cost_num_id),
    type: blankToNull(raw.evidence_cost_type),
    description: blankToNull(raw.evidence_cost_description),
    min: num(raw.evidence_cost_min),
    max: num(raw.evidence_cost_max),
    calculation: strings(raw.evidence_cost_calculation),
    paymentTypes: strings(raw.evidence_cost_payment_type),
    alternative: raw.evidence_cost_alternative === true,
    code: blankToNull(raw.evidence_cost_code),
    url: blankToNull(raw.evidence_cost_url),
  };
}

function toCrossBorder(process: RawProcess): Procedure["crossBorder"] {
  const crossBorder = {
    provision: strings(process.border_provision),
    sdgCodes: refs(process.sdg_codes),
    sdgResource: blankToNull(process.sdg_resource),
    sdgResourceOther: blankToNull(process.sdg_resource_other),
    sdgNotes: blankToNull(process.sdg_notes),
    lackOfResponseRule: blankToNull(process.sdg_lack_of_response_rule),
    naceCodes: refs(process.nace_codes),
    source: strings(process.source),
  };

  const empty =
    crossBorder.provision.length === 0 &&
    crossBorder.sdgCodes.length === 0 &&
    crossBorder.naceCodes.length === 0 &&
    crossBorder.source.length === 0 &&
    !crossBorder.sdgResource &&
    !crossBorder.sdgResourceOther &&
    !crossBorder.sdgNotes &&
    !crossBorder.lackOfResponseRule;

  return empty ? null : crossBorder;
}

/* -------------------------------------------------------------------------- */
/* The register of bodies                                                     */
/* -------------------------------------------------------------------------- */

/** The largest page upstream serves; asking for more is a 400. */
const ORGANIZATION_PAGE_SIZE = 1_000;

/**
 * Every body in the registry — 2,762 today, three pages, under a second.
 * Upstream has no lookup by id and no search: `organizations/{id}` is a 404
 * and a `search` parameter is a 400. The whole register is held instead.
 */
export async function fetchOrganizations(signal: AbortSignal): Promise<Organization[]> {
  const organizations: Organization[] = [];

  for (let page = 1; ; page += 1) {
    const body = await api.getJson<RawPage<RawOrganization>>("organizations", {
      query: { page, limit: ORGANIZATION_PAGE_SIZE },
      signal,
    });

    for (const raw of body.data ?? []) organizations.push(toOrganization(raw));

    if (!body.next_page || (body.data ?? []).length === 0) break;
  }

  return organizations;
}

function toOrganization(raw: RawOrganization): Organization {
  const metadata = raw.metadata ?? {};
  const fek = metadata.foundationFek;
  const fekIssue = blankToNull(fek?.issue);
  const fekNumber = numberText(fek?.number);
  const fekYear = numberText(fek?.year);

  return {
    id: String(raw.id),
    name: raw.title?.el?.trim() || blankToNull(metadata.preferredLabel) || `#${raw.id}`,
    nameEn: blankToNull(raw.title?.en),
    vatId: blankToNull(metadata.vatId),
    parentId: blankToNull(raw.parent_id),
    status: blankToNull(metadata.status),
    address: blankToNull(metadata.mainAddress?.fullAddress),
    postCode: blankToNull(metadata.mainAddress?.postCode),
    email: blankToNull(metadata.contactPoint?.email),
    telephone: blankToNull(metadata.contactPoint?.telephone),
    website: blankToNull(metadata.url),
    typeCode: num(metadata.organizationType),
    foundedOn: blankToNull(metadata.foundationDate),
    foundingGazette:
      fekIssue || fekNumber || fekYear ? { issue: fekIssue, number: fekNumber, year: fekYear } : null,
    terminatedOn: blankToNull(metadata.terminationDate),
    updatedOn: blankToNull(metadata.mainDataUpdateDate),
  };
}

const ORGANIZATIONS_KEY = cacheKey("gr/mitos:organizations", {});

export function loadOrganizations(cache: Cache, signal: AbortSignal): Promise<Organization[]> {
  return withCache(cache, ORGANIZATIONS_KEY, INDEX_TTL_SECONDS, () => fetchOrganizations(signal));
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isLabel(value: RawRef): value is RawLabel {
  return typeof value === "object" && value !== null && "id" in value;
}

function ref(value: RawRef): Ref | null {
  if (value === null || value === undefined) return null;
  if (isLabel(value)) {
    return {
      id: String(value.id),
      name: blankToNull(value.title?.el),
      nameEn: blankToNull(value.title?.en),
    };
  }
  const id = typeof value === "number" ? String(value) : value.trim();
  return id ? { id, name: null, nameEn: null } : null;
}

function refs(values: RawRef[] | null | undefined): Ref[] {
  return (values ?? []).flatMap((value) => {
    const resolved = ref(value);
    return resolved ? [resolved] : [];
  });
}

function strings(values: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const value of values ?? []) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) out.push(text);
  }
  return out;
}

function glancePoints(entry: RawGlanceEntry | null | undefined): Link[] {
  const value = entry?.value;
  if (!Array.isArray(value)) return [];
  return value.map((point) => ({ title: blankToNull(point.title), url: blankToNull(point.url) }));
}

function glanceText(entry: RawGlanceEntry | null | undefined): string | null {
  const value = entry?.value;
  return typeof value === "string" ? blankToNull(value) : null;
}

/** Older records write step flags as "t"/"f" rather than booleans. */
function flag(value: boolean | string | null | undefined): boolean {
  return value === true || value === "t" || value === "true";
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A number or a string, as upstream writes Gazette numbers both ways; "0" means none. */
function numberText(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) && value !== 0 ? String(value) : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && trimmed !== "0" ? trimmed : null;
  }
  return null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function range(min: string | null | undefined, max: string | null | undefined): DurationRange {
  return { min: duration(min), max: duration(max) };
}

const DURATION = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u;

/**
 * Upstream writes every duration as ISO 8601 — `PT10M`, `P10D`, `P1M` — which
 * a model reads well enough, but a person is handed the reading too.
 */
function duration(iso: string | null | undefined): Duration | null {
  const value = blankToNull(iso);
  if (!value) return null;

  const match = DURATION.exec(value);
  if (!match) return { iso: value, text: value };

  const units: [string, string | undefined][] = [
    ["year", match[1]],
    ["month", match[2]],
    ["week", match[3]],
    ["day", match[4]],
    ["hour", match[5]],
    ["minute", match[6]],
    ["second", match[7]],
  ];
  const parts: string[] = [];
  for (const [unit, amount] of units) {
    if (amount === undefined) continue;
    const count = Number(amount);
    if (count === 0) continue;
    parts.push(`${count} ${unit}${count === 1 ? "" : "s"}`);
  }

  return { iso: value, text: parts.length === 0 ? "0 seconds" : parts.join(" ") };
}

/** Runs `fn` over `items` with at most `concurrency` in flight, results in order. */
async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
