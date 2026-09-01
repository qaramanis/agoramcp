import {
  cacheKey,
  createHttpClient,
  InvalidInputError,
  isAgoraError,
  NotFoundError,
  UpstreamError,
  withCache,
  type AgoraError,
  type Cache,
} from "@agoramcp/core";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * The OpenData tree is read-only and unauthenticated. The authenticated half of
 * Diavgeia lives under `/api` and is for publishing bodies — we never touch it.
 */
export const BASE_URL = "https://diavgeia.gov.gr/opendata/";

/** The viewable decision page, which upstream never returns in the record. */
const DECISION_PAGE_PREFIX = "https://diavgeia.gov.gr/decision/view/";

const http = createHttpClient({
  baseUrl: BASE_URL,
  // Broad queries against a 3M-document index are genuinely slow.
  timeoutMs: 20_000,
  retries: 2,
});

/* -------------------------------------------------------------------------- */
/* Upstream shapes                                                            */
/* -------------------------------------------------------------------------- */

interface RawMoney {
  amount?: number | null;
  currency?: string | null;
}

interface RawSponsor {
  expenseAmount?: RawMoney | null;
  /** Budget line the expense is charged to (Κωδικός Αριθμός Εξόδου). */
  kae?: string | null;
}

/** Per-budget-line breakdown on a commitment act. */
interface RawKaeAmount {
  kae?: string | null;
  amountWithVAT?: number | null;
}

interface RawOrgField {
  afm?: string | null;
  name?: string | null;
}

/**
 * Free-form and keyed by decision type: a payment act carries `sponsor`, an
 * award carries different fields entirely. Only `org` and `sponsor` are read
 * here; the rest is passed through untouched by `get_decision`.
 *
 * `org` is the *counterparty* — the supplier, payee or beneficiary named on an
 * expenditure act — not the body that issued it. The issuer is the top-level
 * `organizationId`, and the two differ on every procurement act.
 */
interface RawExtraFields {
  org?: RawOrgField | null;
  /** Β.2.1, Β.2.2 — money actually being paid out. */
  sponsor?: RawSponsor[] | null;
  /** Β.1.3 — a commitment against the budget. */
  amountWithVAT?: RawMoney | null;
  amountWithKae?: RawKaeAmount[] | null;
  /** Δ.1 — the value a contract was awarded at. */
  awardAmount?: RawMoney | null;
  /** Δ.2.1 — the pre-tender estimate. */
  estimatedAmount?: RawMoney | null;
  [key: string]: unknown;
}

/** One file attached to an act beyond its signed PDF, as the record lists it. */
interface RawAttachment {
  id: string;
  description?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  checksum?: string | null;
  size?: number | null;
}

export interface RawDecision {
  ada: string;
  subject: string;
  protocolNumber?: string | null;
  /**
   * Epoch milliseconds at midnight of the issue date — UTC midnight on most
   * acts, Athens midnight on some. See `toIsoDate`.
   */
  issueDate: number;
  publishTimestamp: number;
  submissionTimestamp: number;
  organizationId: string;
  signerIds?: string[] | null;
  unitIds?: string[] | null;
  decisionTypeId: string;
  thematicCategoryIds?: string[] | null;
  extraFieldValues?: RawExtraFields | null;
  privateData?: boolean | null;
  status: string;
  versionId: string;
  url: string;
  documentUrl: string;
  documentChecksum?: string | null;
  attachments?: RawAttachment[] | null;
  correctedVersionId?: string | null;
}

export interface RawSearchInfo {
  /** The Lucene query actually executed — the only way to see applied defaults. */
  query: string;
  page: number;
  size: number;
  actualSize: number;
  total: number;
  order: string;
}

interface RawSearchResponse {
  decisions?: RawDecision[] | null;
  info: RawSearchInfo;
}

interface RawOrganization {
  uid: string;
  label: string;
  abbreviation?: string | null;
  vatNumber?: string | null;
  category?: string | null;
  status?: string | null;
  /** Slug used in diavgeia's own URLs; occasionally the only Latin spelling. */
  latinName?: string | null;
  website?: string | null;
  /** The body this one answers to — a hospital's ministry, a school's region. */
  supervisorId?: string | null;
  supervisorLabel?: string | null;
  /** Government Gazette reference for the act that established the body. */
  fekNumber?: string | null;
  fekIssue?: string | null;
  fekYear?: string | null;
}

interface RawOrganizationsResponse {
  organizations?: RawOrganization[] | null;
}

interface RawUnit {
  uid: string;
  label: string;
  abbreviation?: string | null;
  /** `DEPARTMENT`, `ADMINISTRATION`, `UNIT`, … — upstream's own taxonomy. */
  category?: string | null;
  active?: boolean | null;
  activeFrom?: number | null;
  activeUntil?: number | null;
  parentId?: string | null;
}

interface RawUnitsResponse {
  units?: RawUnit[] | null;
}

/** One posting: which unit the signer holds a position in, and which position. */
interface RawSignerUnit {
  uid: string;
  positionId?: string | null;
  positionLabel?: string | null;
  activationDate?: number | null;
  deactivationDate?: number | null;
}

interface RawSigner {
  uid: string;
  firstName?: string | null;
  lastName?: string | null;
  active?: boolean | null;
  activeFrom?: number | null;
  activeUntil?: number | null;
  organizationId?: string | null;
  hasOrganizationSignRights?: boolean | null;
  units?: RawSignerUnit[] | null;
}

interface RawDictionaryItem {
  uid: string;
  label: string;
  parent?: string | null;
}

interface RawDictionaryResponse {
  name?: string | null;
  items?: RawDictionaryItem[] | null;
}

export interface RawDecisionType {
  uid: string;
  label: string;
  parent: string | null;
  /** False for grouping nodes that cannot be assigned to an act. */
  allowedInDecisions: boolean;
}

interface RawTypesResponse {
  decisionTypes?: RawDecisionType[] | null;
}

/** One field an act of a given type carries, as `types/{uid}/details.json` describes it. */
interface RawTypeField {
  uid: string;
  label?: string | null;
  help?: string | null;
  type?: string | null;
  required?: boolean | null;
  multiple?: boolean | null;
  /** Vocabulary the value is drawn from, e.g. `CPV`. */
  dictionary?: string | null;
  fixedValueList?: string[] | null;
  /** The Lucene field this value is indexed under, or null when it is not searchable. */
  searchTerm?: string | null;
}

interface RawTypeDetail extends RawDecisionType {
  extraFields?: RawTypeField[] | null;
}

interface RawVersion {
  versionId: string;
  /** Internal `{org}_{user}` id of the account that filed it. Not surfaced. */
  creator?: string | null;
  versionTimestamp?: number | null;
  /** Free text the body entered — on a revocation, the reason for it. */
  description?: string | null;
  status?: string | null;
  correctedVersionId?: string | null;
}

interface RawVersionLog {
  ada: string;
  organizationId?: string | null;
  versions?: RawVersion[] | null;
}

interface RawSignersResponse {
  signers?: RawSigner[] | null;
}

interface RawDictionariesResponse {
  dictionaries?: { uid: string; label: string }[] | null;
}

/* -------------------------------------------------------------------------- */
/* Normalised shapes                                                          */
/* -------------------------------------------------------------------------- */

export interface MoneyTotal {
  currency: string;
  amount: number;
}

export interface ExpenseItem {
  amount: number;
  currency: string;
  kae: string | null;
}

/**
 * Which upstream field the figures came from, named for what it means rather
 * than where it sits. These are not interchangeable: an estimate is what a
 * tender was expected to cost, an award is what it went for, a commitment is
 * money set aside, and a payment is money leaving the account. Summing across
 * them double-counts the same euro at four stages of its life.
 */
export type ExpenseBasis = "payment" | "commitment" | "award" | "estimate";

export interface Expenses {
  basis: ExpenseBasis;
  /** Summed per currency: acts occasionally mix EUR with another currency. */
  totals: MoneyTotal[];
  items: ExpenseItem[];
}

/** The publishing body, resolved from `organizations/{uid}.json`. */
export interface Organization {
  id: string;
  name: string;
  abbreviation: string | null;
  vatNumber: string | null;
  /** `MINISTRY`, `NPDD`, `OTA1`, … — upstream's own taxonomy. */
  category: string | null;
  status: string | null;
}

/** The supplier, payee or beneficiary an expenditure act names. */
export interface Counterparty {
  name: string | null;
  vatNumber: string | null;
}

export interface DecisionSummary {
  ada: string;
  subject: string;
  protocolNumber: string | null;
  /** Calendar date the act was signed, `YYYY-MM-DD`. */
  issuedOn: string;
  publishedAt: string;
  status: string;
  decisionTypeId: string;
  thematicCategoryIds: string[];
  /**
   * The body that issued the act. `name` is null only when the uid could not
   * be resolved — a lookup failure never fails the surrounding search.
   */
  organization: Organization | { id: string; name: null };
  /** Named only on expenditure acts; null everywhere else. */
  counterparty: Counterparty | null;
  signerIds: string[];
  unitIds: string[];
  /** Present only on acts that declare expenditure. */
  expenses: Expenses | null;
  /** Human-readable page on diavgeia.gov.gr. */
  pageUrl: string;
  /** Internal API URL upstream reports as `url`. Kept for traceability. */
  apiUrl: string;
  /** The signed PDF itself. */
  documentUrl: string;
}

export interface Attachment {
  id: string;
  filename: string | null;
  description: string | null;
  mimeType: string | null;
  /** Bytes. */
  size: number | null;
  checksum: string | null;
  /** The file itself. */
  url: string;
}

export interface DecisionDetail extends DecisionSummary {
  versionId: string;
  documentChecksum: string | null;
  attachmentCount: number;
  /** Annexes, tables, the tender document — anything filed alongside the PDF. */
  attachments: Attachment[];
  /** Set when this act is a correction of an earlier version. */
  correctedVersionId: string | null;
  /** Whether the upstream withheld the body for privacy reasons. */
  redacted: boolean;
  /**
   * Type-specific fields, verbatim. Their keys vary by `decisionTypeId` and
   * upstream documents no schema for them, so they are passed through rather
   * than flattened into a shape that would silently drop the unexpected ones.
   */
  extraFields: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export type DecisionStatus = "published" | "revoked" | "all";

export interface SearchQuery {
  text?: string | undefined;
  subject?: string | undefined;
  protocolNumber?: string | undefined;
  organizationId?: string | undefined;
  unitId?: string | undefined;
  signerId?: string | undefined;
  decisionType?: string | undefined;
  thematicCategory?: string | undefined;
  issuedFrom?: string | undefined;
  issuedTo?: string | undefined;
  publishedFrom?: string | undefined;
  publishedTo?: string | undefined;
  status: DecisionStatus;
  page: number;
  size: number;
}

export interface SearchResult {
  info: RawSearchInfo;
  decisions: DecisionSummary[];
}

export interface DayWindow {
  from: string;
  to: string;
}

/**
 * Upstream's hard limit on one search. An `issueDate` range longer than this
 * is cut to `from + 180 days` without a word — measured, not documented:
 * 2026-01-01 becomes 2026-06-30 and 2025-07-01 becomes 2025-12-28.
 */
export const MAX_WINDOW_DAYS = 180;

/** Διαύγεια went live in October 2010; nothing carries an earlier date. */
export const REGISTER_START = "2010-01-01";

/**
 * How the index spells status. Records say `PUBLISHED` and `REVOKED`; the
 * Lucene filter wants the Greek, and the two are not interchangeable.
 */
const STATUS_CLAUSE: Record<DecisionStatus, string | null> = {
  published: 'status:"Αναρτημένη"',
  revoked: 'status:"Ανακληθείσα"',
  all: null,
};

/**
 * `search.json` and `search/advanced.json` run the same Lucene query, but only
 * the advanced one lets the caller write the date bounds — and that matters.
 * The simple endpoint turns `to_issue_date=2026-08-20` into
 * `TO 2026-08-20T00:00+03:00`, and because most acts carry an issue timestamp
 * of 03:00 Athens time, that bound excludes nearly the whole day it names: 459
 * acts matched where 12,164 were issued. Writing `T23:59:59` ourselves is the
 * only way to make `issuedTo` mean the day it says.
 *
 * The simple parameters map one-to-one onto fields (`term` is `q`, `org` is
 * `organizationUid`, …), verified by comparing totals over the same window.
 */
export function buildSearchQuery(query: SearchQuery): string {
  const clauses: string[] = [];
  const term = (field: string, value: string | undefined) => {
    if (value !== undefined) clauses.push(`${field}:${phrase(value)}`);
  };

  term("q", query.text);
  term("subject", query.subject);
  term("protocolNumber", query.protocolNumber);
  term("organizationUid", query.organizationId);
  term("unitUid", query.unitId);
  term("signerUid", query.signerId);
  term("decisionTypeUid", query.decisionType);
  term("thematicCategoryUid", query.thematicCategory);

  const issued = issueWindow(query);
  if (issued) clauses.push(dayRange("issueDate", issued.from, issued.to));

  if (query.publishedFrom !== undefined || query.publishedTo !== undefined) {
    clauses.push(
      dayRange(
        "publishTimestamp",
        query.publishedFrom ?? REGISTER_START,
        query.publishedTo ?? todayInAthens(),
      ),
    );
  }

  const status = STATUS_CLAUSE[query.status];
  if (status) clauses.push(status);

  return clauses.join(" AND ");
}

/**
 * The issue-date window to ask for, or null to let upstream apply its own
 * default of the last 180 days. A Lucene range needs both bounds, so only
 * `issuedTo` means the 180 days ending there — the widest window upstream
 * honours, ending where the caller said.
 */
export function issueWindow(query: Pick<SearchQuery, "issuedFrom" | "issuedTo">): DayWindow | null {
  const { issuedFrom, issuedTo } = query;
  if (issuedFrom !== undefined) return { from: issuedFrom, to: issuedTo ?? todayInAthens() };
  if (issuedTo !== undefined) return { from: addDays(issuedTo, -MAX_WINDOW_DAYS), to: issuedTo };
  return null;
}

/** A quoted Lucene phrase. Only the quote and the backslash need escaping inside one. */
function phrase(value: string): string {
  return `"${value.replace(/["\\]/gu, "\\$&")}"`;
}

/** Whole calendar days, Athens time — the zone upstream reads a bare `DT()` in. */
function dayRange(field: string, from: string, to: string): string {
  return `${field}:[DT(${from}T00:00:00) TO DT(${to}T23:59:59)]`;
}

export async function searchDecisions(
  query: SearchQuery,
  signal: AbortSignal,
): Promise<SearchResult> {
  return runSearch(buildSearchQuery(query), query.page, query.size, signal);
}

/**
 * Runs a Lucene query as written. Upstream answers a malformed one with a 400
 * whose body names the failing position. That is the caller's query to fix,
 * so it is surfaced as invalid input rather than as an upstream fault, which
 * would read as "try again".
 */
export async function runSearch(
  q: string,
  page: number,
  size: number,
  signal: AbortSignal,
): Promise<SearchResult> {
  let body: RawSearchResponse;
  try {
    body = await http.getJson<RawSearchResponse>("search/advanced.json", {
      query: { q, page, size },
      signal,
    });
  } catch (error) {
    if (isAgoraError(error) && error.status === 400) {
      throw new InvalidInputError(
        `Διαύγεια rejected the query: ${upstreamMessage(error) ?? "syntax error"}`,
        { cause: error, details: { query: q } },
      );
    }
    throw error;
  }

  return { info: body.info, decisions: (body.decisions ?? []).map(toSummary) };
}

/**
 * The message inside upstream's JSON error envelope. The HTTP client keeps
 * only the first 500 bytes of a failed body, which is not always a complete
 * document, so a regex stands in when the parse fails.
 */
function upstreamMessage(error: AgoraError): string | null {
  const body = error.details?.body;
  if (typeof body !== "string") return null;

  let message: string | null;
  try {
    const parsed = JSON.parse(body) as { errors?: { errorMessage?: string | null }[] | null };
    message = parsed.errors?.[0]?.errorMessage?.trim() || null;
  } catch {
    const match = /"errorMessage":"((?:[^"\\]|\\.)*)/u.exec(body);
    message = match?.[1] ? match[1].replaceAll("\\n", " ").trim() : null;
  }

  // A parse failure names the grammar rule it died in, forty levels deep. The
  // position and the caret line after it are what a caller can act on.
  return message?.replace(/^Error while parsing action '[^']*' /u, "Syntax error ") ?? null;
}

/** Long: a body's name and VAT number change on the order of years. */
export const ORGANIZATION_TTL_SECONDS = 86_400;

/**
 * Resolves issuer uids to names. Search results carry only a numeric
 * `organizationId`, which is useless to a reader, and upstream has no bulk
 * lookup — `organizations.json` returns the entire 2.5 MB register whatever
 * paging you ask for. Per-uid fetches are ~450 B and ~250 ms, deduplicated
 * within a page, issued in parallel and cached for a day, so a warm page adds
 * nothing and a cold one adds roughly a single round trip.
 */
export async function resolveOrganizations(
  ids: readonly string[],
  cache: Cache,
  signal: AbortSignal,
): Promise<Map<string, Organization>> {
  const resolved = new Map<string, Organization>();

  // The held register — filled at boot by `warm` — already names every body,
  // dissolved ones included. Only what it lacks goes to the per-uid endpoint.
  const register = await peekRegister(cache);
  const known = new Map(register?.map((match) => [match.id, match]) ?? []);
  const unique = [...new Set(ids)].filter((id) => {
    const match = known.get(id);
    if (!match) return true;
    resolved.set(id, {
      id: match.id,
      name: match.name,
      abbreviation: match.abbreviation,
      vatNumber: match.vatNumber,
      category: match.category,
      status: match.status,
    });
    return false;
  });

  await Promise.all(
    unique.map(async (id) => {
      const organization = await withCache(
        cache,
        cacheKey("gr/diavgeia:organization", id),
        ORGANIZATION_TTL_SECONDS,
        () => fetchOrganization(id, signal),
      );
      if (organization) resolved.set(id, organization);
    }),
  );

  return resolved;
}

/** Returns null for an unknown uid rather than throwing: a body that has been
 *  removed from the register must not fail a search that merely mentions it. */
async function fetchOrganization(uid: string, signal: AbortSignal): Promise<Organization | null> {
  try {
    const raw = await http.getJson<RawOrganization>(
      `organizations/${encodeURIComponent(uid)}.json`,
      { signal },
    );
    return {
      id: raw.uid,
      name: raw.label,
      abbreviation: raw.abbreviation ?? null,
      vatNumber: raw.vatNumber ?? null,
      category: raw.category ?? null,
      status: raw.status ?? null,
    };
  } catch (error) {
    if (isAgoraError(error) && error.status === 404) return null;
    throw error;
  }
}

/** Folds resolved issuers back into decisions, in place of the bare uid. */
export function attachOrganizations<T extends DecisionSummary>(
  decisions: readonly T[],
  organizations: ReadonlyMap<string, Organization>,
): T[] {
  return decisions.map((decision) => {
    const organization = organizations.get(decision.organization.id);
    return organization ? { ...decision, organization } : decision;
  });
}

export async function fetchDecision(ada: string, signal: AbortSignal): Promise<DecisionDetail> {
  const path = `decisions/${encodeURIComponent(ada)}.json`;

  let raw: RawDecision;
  try {
    raw = await http.getJson<RawDecision>(path, { signal });
  } catch (error) {
    // Upstream answers a bad ΑΔΑ with a 404 and a ResourceNotFoundException
    // body. Surfacing that as a generic upstream fault would tell the model to
    // retry something that can never succeed.
    if (isAgoraError(error) && error.status === 404) {
      throw new NotFoundError(
        `No decision published under ΑΔΑ "${ada}". Check the code, or search for the act instead.`,
        { details: { ada } },
      );
    }
    throw error;
  }

  return {
    ...toSummary(raw),
    versionId: raw.versionId,
    documentChecksum: raw.documentChecksum ?? null,
    attachmentCount: raw.attachments?.length ?? 0,
    attachments: (raw.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      filename: blankToNull(attachment.filename),
      description: blankToNull(attachment.description),
      mimeType: attachment.mimeType ?? null,
      size: typeof attachment.size === "number" ? attachment.size : null,
      checksum: attachment.checksum ?? null,
      // `attachments/{id}` alone answers with this same metadata; the file is
      // one segment further down.
      url: `${BASE_URL}decisions/${encodeURIComponent(raw.ada)}/attachments/${encodeURIComponent(attachment.id)}/document`,
    })),
    correctedVersionId: raw.correctedVersionId ?? null,
    redacted: raw.privateData === true,
    extraFields: stripReadFields(raw.extraFieldValues),
  };
}

export async function fetchDecisionTypes(signal: AbortSignal): Promise<RawDecisionType[]> {
  const body = await http.getJson<RawTypesResponse>("types.json", { signal });
  return body.decisionTypes ?? [];
}

/* -------------------------------------------------------------------------- */
/* The signed PDF                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Bounded, because an act with scanned annexes can run to hundreds of MB and
 * would be held in memory whole. Text-bearing acts are a few hundred KB.
 */
const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

export async function fetchDecisionDocument(ada: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await http.request(`decisions/${encodeURIComponent(ada)}/document`, {
    signal,
    timeoutMs: 60_000,
    // The client asks for JSON by default; this endpoint answers that with 406.
    headers: { accept: "*/*" },
  });

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
    await response.arrayBuffer().catch(() => undefined);
    throw tooLarge(ada, declared);
  }

  // An unknown ΑΔΑ is redirected to the old site rather than refused, and the
  // client follows redirects — so what came back is checked, not assumed.
  if (!(response.headers.get("content-type") ?? "").includes("application/pdf")) {
    await response.arrayBuffer().catch(() => undefined);
    throw new NotFoundError(`No PDF is published for ΑΔΑ "${ada}".`, { details: { ada } });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw tooLarge(ada, bytes.byteLength);
  return bytes;
}

function tooLarge(ada: string, bytes: number): UpstreamError {
  return new UpstreamError(
    `The PDF for ΑΔΑ "${ada}" is ${Math.round(bytes / 1_048_576)} MB — too large to read here. It can be downloaded from ${BASE_URL}decisions/${ada}/document.`,
    { status: 413, details: { ada, bytes } },
  );
}

export interface DecisionText {
  pageCount: number;
  /** One entry per page, in order, whitespace tidied. Empty where a page has no text layer. */
  pages: string[];
}

/** The text layer of a PDF, page by page. A scanned act yields empty pages, not an error. */
export async function extractDecisionText(bytes: Uint8Array): Promise<DecisionText> {
  // Quiet: pdf.js reports every oddity in a signed government PDF to the console.
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { pageCount: totalPages, pages: text.map(tidyText) };
  } finally {
    // Frees the parsed document and its worker; the proxy has no destroy of its own.
    await pdf.loadingTask.destroy();
  }
}

/** Runs of spaces to one, stray spaces off line ends, blank runs to one blank line. */
function tidyText(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/gu, " ")
    .replace(/ ?\n ?/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                              */
/* -------------------------------------------------------------------------- */

function toSummary(raw: RawDecision): DecisionSummary {
  const other = raw.extraFieldValues?.org;

  return {
    ada: raw.ada,
    subject: raw.subject,
    protocolNumber: raw.protocolNumber ?? null,
    issuedOn: toIsoDate(raw.issueDate),
    publishedAt: toIsoDateTime(raw.publishTimestamp),
    status: raw.status,
    decisionTypeId: raw.decisionTypeId,
    thematicCategoryIds: raw.thematicCategoryIds ?? [],
    // Left unresolved on purpose: `resolveOrganizations` fills the name in,
    // batched across the whole page rather than one fetch per decision.
    organization: { id: raw.organizationId, name: null },
    counterparty:
      other && (other.name ?? other.afm)
        ? { name: other.name ?? null, vatNumber: other.afm ?? null }
        : null,
    signerIds: raw.signerIds ?? [],
    unitIds: raw.unitIds ?? [],
    expenses: toExpenses(raw.extraFieldValues),
    // Built rather than taken from `raw.url`, which is upstream's internal
    // `/luminapi/api/...` endpoint and not a page a person can open. The ΑΔΑ is
    // left unescaped to match `documentUrl`, which upstream returns raw; an ΑΔΑ
    // is only Greek capitals, digits and a hyphen, so nothing needs escaping.
    pageUrl: `${DECISION_PAGE_PREFIX}${raw.ada}`,
    apiUrl: raw.url,
    documentUrl: raw.documentUrl,
  };
}

/**
 * `org` and `sponsor` are already promoted onto the summary; repeating them
 * verbatim would double the payload of every detail response.
 */
function stripReadFields(extra: RawExtraFields | null | undefined): Record<string, unknown> {
  if (!extra) return {};
  const { org: _org, sponsor: _sponsor, ...rest } = extra;
  return rest;
}

/**
 * Diavgeia carries money in a different field for each family of act, so a
 * single `amount` key would have found figures on payment acts only — roughly
 * a third of the financial ones.
 */
function toExpenses(extra: RawExtraFields | null | undefined): Expenses | null {
  if (!extra) return null;

  const payment = fromSponsor(extra.sponsor);
  if (payment) return payment;

  const commitment = fromCommitment(extra);
  if (commitment) return commitment;

  const award = fromSingleAmount(extra.awardAmount, "award");
  if (award) return award;

  return fromSingleAmount(extra.estimatedAmount, "estimate");
}

function fromSponsor(sponsor: RawSponsor[] | null | undefined): Expenses | null {
  if (!sponsor || sponsor.length === 0) return null;

  const items: ExpenseItem[] = [];
  for (const entry of sponsor) {
    const amount = entry.expenseAmount?.amount;
    if (!isMoney(amount)) continue;
    items.push({
      amount,
      currency: entry.expenseAmount?.currency ?? "EUR",
      kae: entry.kae ?? null,
    });
  }

  return items.length === 0 ? null : { basis: "payment", totals: sumByCurrency(items), items };
}

function fromCommitment(extra: RawExtraFields): Expenses | null {
  const currency = extra.amountWithVAT?.currency ?? "EUR";

  const items: ExpenseItem[] = [];
  for (const entry of extra.amountWithKae ?? []) {
    if (!isMoney(entry.amountWithVAT)) continue;
    items.push({ amount: entry.amountWithVAT, currency, kae: entry.kae ?? null });
  }

  if (items.length > 0) {
    return { basis: "commitment", totals: sumByCurrency(items), items };
  }

  // Some commitment acts carry the headline figure without a per-line split.
  const total = extra.amountWithVAT?.amount;
  if (!isMoney(total)) return null;
  return {
    basis: "commitment",
    totals: [{ currency, amount: round2(total) }],
    items: [{ amount: total, currency, kae: null }],
  };
}

function fromSingleAmount(money: RawMoney | null | undefined, basis: ExpenseBasis): Expenses | null {
  const amount = money?.amount;
  if (!isMoney(amount)) return null;
  const currency = money?.currency ?? "EUR";
  return {
    basis,
    totals: [{ currency, amount: round2(amount) }],
    items: [{ amount, currency, kae: null }],
  };
}

/** Summed per currency: adding EUR to another currency would be confidently wrong. */
function sumByCurrency(items: readonly ExpenseItem[]): MoneyTotal[] {
  const byCurrency = new Map<string, number>();
  for (const item of items) {
    byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? 0) + item.amount);
  }
  return [...byCurrency.entries()].map(([currency, amount]) => ({
    currency,
    amount: round2(amount),
  }));
}

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Float addition over cents drifts; two decimals is the domain's precision. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Upstream stamps an issue date at midnight, but not always the same midnight:
 * most acts carry UTC midnight (03:00 in Athens), a few carry Athens midnight
 * (21:00 UTC the evening before). Read in UTC the second kind lands on the
 * wrong day; read in Athens time both land on the day the act was signed.
 */
const ATHENS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Athens",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toIsoDate(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "unknown";
  return ATHENS_DAY.format(epochMs);
}

export function todayInAthens(): string {
  return ATHENS_DAY.format(Date.now());
}

/** `YYYY-MM-DD` plus a number of days, on the calendar rather than the clock. */
export function addDays(day: string, days: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function toIsoDateTime(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "unknown";
  return new Date(epochMs).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Register: organizations, units, signers, vocabularies                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything `organizations/{uid}.json` carries, as opposed to the six fields
 * `Organization` promotes onto a search result. The extra fields are what make
 * a body identifiable to a person — who supervises it, where its site is, which
 * Gazette issue created it — and are dead weight repeated on every row of a
 * hundred-act page, which is why the summary shape stays lean.
 */
export interface OrganizationDetail extends Organization {
  latinName: string | null;
  website: string | null;
  supervisor: { id: string; name: string | null } | null;
  fek: { number: string; issue: string; year: string } | null;
}

/** A department, directorate or branch within a body. */
export interface OrganizationUnit {
  id: string;
  label: string;
  abbreviation: string | null;
  category: string | null;
  active: boolean;
  /** `YYYY-MM-DD`, or null where upstream leaves the bound open. */
  activeFrom: string | null;
  activeUntil: string | null;
  /** Units nest: a department sits under a directorate under the body itself. */
  parentId: string | null;
}

export interface SignerPosting {
  unitId: string;
  /** Filled in by the tools from the body's unit list; null until then. */
  unitLabel: string | null;
  positionId: string | null;
  positionLabel: string | null;
  from: string | null;
  until: string | null;
}

/** The official who signed an act, behind the bare uid a decision carries. */
export interface Signer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Convenience join, so a caller need not guess the name order. */
  name: string | null;
  active: boolean;
  activeFrom: string | null;
  activeUntil: string | null;
  organizationId: string | null;
  /** Whether they may sign on behalf of the whole body, not just a unit. */
  canSignForOrganization: boolean;
  postings: SignerPosting[];
}

export interface DictionaryEntry {
  code: string;
  label: string;
  parent: string | null;
}

/** A register row, trimmed to what identifies a body in a list of matches. */
export interface OrganizationMatch {
  id: string;
  name: string;
  abbreviation: string | null;
  vatNumber: string | null;
  category: string | null;
  /** `active`, `inactive` (dissolved or merged) or `pending`. */
  status: string | null;
  supervisorName: string | null;
}

/** Bodies and vocabularies change on the order of years, not minutes. */
export const REGISTER_TTL_SECONDS = 86_400;

/**
 * The whole register in one document: 5,838 bodies, 2.7 MB, ~19 s.
 *
 * Upstream has no name search — `organizations.json` honours `status` and
 * nothing else — so searching by name means holding the register and matching
 * locally. `status=all` costs the same 19 s as the active bodies alone and adds
 * the 414 dissolved ones, so it is fetched once for every purpose: the name
 * search, the inactive-bodies option, and resolving issuers on search pages.
 *
 * The timeout is raised for this one call. Measured at 17-19 s, it sits inside
 * the shared client's 20 s budget by luck rather than by margin.
 */
export async function fetchOrganizationRegister(signal: AbortSignal): Promise<OrganizationMatch[]> {
  const body = await http.getJson<RawOrganizationsResponse>("organizations.json", {
    query: { status: "all" },
    signal,
    timeoutMs: 90_000,
    // A retry means another 2.7 MB and another 19 s. One attempt is enough.
    retries: 0,
  });

  return (body.organizations ?? []).map((raw) => ({
    id: raw.uid,
    name: raw.label,
    abbreviation: raw.abbreviation ?? null,
    vatNumber: raw.vatNumber ?? null,
    category: raw.category ?? null,
    status: raw.status ?? null,
    supervisorName: raw.supervisorLabel ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Register cache: held a week, refreshed in the background after a day        */
/* -------------------------------------------------------------------------- */

const REGISTER_KEY = cacheKey("gr/diavgeia:organization_register", "all");

/**
 * Far longer than the register is trusted for. The point is that it never
 * simply expires: a caller who finds it older than a day gets the copy in
 * hand and triggers a refresh behind them, so the 19 s is paid off the
 * request path — at boot, by `warm`, and once a day after that.
 */
const REGISTER_HOLD_SECONDS = 7 * 86_400;

interface HeldRegister {
  fetchedAt: number;
  organizations: OrganizationMatch[];
}

/** One background refresh at a time, whoever noticed the age first. */
let refreshing: Promise<void> | null = null;

/** The register, from cache when held, otherwise fetched now. */
export async function loadRegister(cache: Cache, signal: AbortSignal): Promise<OrganizationMatch[]> {
  const held = await cache.get<HeldRegister>(REGISTER_KEY);
  if (held) {
    if (Date.now() - held.fetchedAt > REGISTER_TTL_SECONDS * 1_000) refreshRegister(cache);
    return held.organizations;
  }

  const fresh = await withCache(cache, REGISTER_KEY, REGISTER_HOLD_SECONDS, async () => ({
    fetchedAt: Date.now(),
    organizations: await fetchOrganizationRegister(signal),
  }));
  return fresh.organizations;
}

/** The register if it happens to be held; never a fetch. */
async function peekRegister(cache: Cache): Promise<OrganizationMatch[] | null> {
  const held = await cache.get<HeldRegister>(REGISTER_KEY);
  return held?.organizations ?? null;
}

function refreshRegister(cache: Cache): void {
  if (refreshing) return;
  // Its own signal: the request that noticed the age may be long gone.
  refreshing = fetchOrganizationRegister(AbortSignal.timeout(180_000))
    .then((organizations) =>
      cache.set(REGISTER_KEY, { fetchedAt: Date.now(), organizations }, REGISTER_HOLD_SECONDS),
    )
    // A failed refresh leaves the held copy in place; the next caller tries again.
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
}

export async function fetchOrganizationDetail(
  uid: string,
  signal: AbortSignal,
): Promise<OrganizationDetail> {
  const raw = await getOrNotFound<RawOrganization>(
    `organizations/${encodeURIComponent(uid)}.json`,
    signal,
    `No public body is registered under uid "${uid}". Search for it by name with search_organizations.`,
    { uid },
  );

  return {
    id: raw.uid,
    name: raw.label,
    abbreviation: raw.abbreviation ?? null,
    vatNumber: raw.vatNumber ?? null,
    category: raw.category ?? null,
    status: raw.status ?? null,
    latinName: raw.latinName ?? null,
    // Stored as "" rather than omitted when a body has no site.
    website: blankToNull(raw.website),
    supervisor: raw.supervisorId
      ? { id: raw.supervisorId, name: blankToNull(raw.supervisorLabel) }
      : null,
    fek: toFek(raw),
  };
}

export async function fetchOrganizationUnits(
  uid: string,
  signal: AbortSignal,
): Promise<OrganizationUnit[]> {
  const body = await getOrNotFound<RawUnitsResponse>(
    `organizations/${encodeURIComponent(uid)}/units.json`,
    signal,
    `No public body is registered under uid "${uid}". Search for it by name with search_organizations.`,
    { uid },
  );

  return (body.units ?? []).map(toUnit);
}

/**
 * One unit by its own uid, without knowing which body it belongs to — which is
 * the position a reader of `unitIds` on a decision is in.
 */
export async function fetchUnit(uid: string, signal: AbortSignal): Promise<OrganizationUnit> {
  const raw = await getOrNotFound<RawUnit>(
    `units/${encodeURIComponent(uid)}.json`,
    signal,
    `No unit is registered under uid "${uid}". Unit uids come from unitIds on a decision or from list_organization_units.`,
    { uid },
  );
  return toUnit(raw);
}

function toUnit(raw: RawUnit): OrganizationUnit {
  return {
    id: raw.uid,
    label: raw.label,
    abbreviation: raw.abbreviation ?? null,
    category: raw.category ?? null,
    active: raw.active !== false,
    activeFrom: toOptionalIsoDate(raw.activeFrom),
    activeUntil: toOptionalIsoDate(raw.activeUntil),
    parentId: raw.parentId ?? null,
  };
}

export async function fetchSigner(uid: string, signal: AbortSignal): Promise<Signer> {
  const raw = await getOrNotFound<RawSigner>(
    `signers/${encodeURIComponent(uid)}.json`,
    signal,
    `No signer is registered under uid "${uid}". Signer uids come from the signerIds on a decision.`,
    { uid },
  );

  return toSigner(raw);
}

/**
 * Everyone registered to sign for one body. Upstream answers an unknown
 * numeric uid with an empty list rather than a 404, so the caller decides
 * whether empty means "nobody" or "no such body".
 */
export async function fetchOrganizationSigners(uid: string, signal: AbortSignal): Promise<Signer[]> {
  const body = await getOrNotFound<RawSignersResponse>(
    `organizations/${encodeURIComponent(uid)}/signers.json`,
    signal,
    `No public body is registered under uid "${uid}". Search for it by name with search_organizations.`,
    { uid },
  );
  return (body.signers ?? []).map(toSigner);
}

function toSigner(raw: RawSigner): Signer {
  const first = blankToNull(raw.firstName);
  const last = blankToNull(raw.lastName);

  return {
    id: raw.uid,
    firstName: first,
    lastName: last,
    name: [first, last].filter(Boolean).join(" ") || null,
    active: raw.active !== false,
    activeFrom: toOptionalIsoDate(raw.activeFrom),
    activeUntil: toOptionalIsoDate(raw.activeUntil),
    organizationId: raw.organizationId ?? null,
    canSignForOrganization: raw.hasOrganizationSignRights === true,
    postings: (raw.units ?? []).map((unit) => ({
      unitId: unit.uid,
      unitLabel: null,
      positionId: unit.positionId ?? null,
      positionLabel: blankToNull(unit.positionLabel),
      from: toOptionalIsoDate(unit.activationDate),
      until: toOptionalIsoDate(unit.deactivationDate),
    })),
  };
}

/**
 * One of the controlled vocabularies listed by `dictionaries.json`. Generic on
 * purpose: `THK` is the only one exposed as a tool today, but `ORG_CATEGORY`
 * and the rest are the same shape and cost nothing to reach later.
 */
export async function fetchDictionary(
  name: string,
  signal: AbortSignal,
): Promise<DictionaryEntry[]> {
  const body = await getOrNotFound<RawDictionaryResponse>(
    `dictionaries/${encodeURIComponent(name)}.json`,
    signal,
    `No dictionary named "${name}". Call list_dictionaries for the valid names.`,
    { dictionary: name },
    // CPV alone is 10,357 entries and 1.2 MB; the rest are a few kilobytes.
    { timeoutMs: 60_000 },
  );

  return (body.items ?? []).map((item) => ({
    code: item.uid,
    label: item.label,
    parent: item.parent ?? null,
  }));
}

export interface Dictionary {
  code: string;
  label: string;
}

/** The index of vocabularies `fetchDictionary` can be pointed at. */
export async function fetchDictionaries(signal: AbortSignal): Promise<Dictionary[]> {
  const body = await http.getJson<RawDictionariesResponse>("dictionaries.json", { signal });
  return (body.dictionaries ?? []).map((entry) => ({ code: entry.uid, label: entry.label }));
}

export interface DecisionVersion {
  versionId: string;
  /** When this version was filed, as an ISO timestamp. */
  at: string | null;
  /** `PUBLISHED`, `PENDING_REVOCATION`, `REVOKED`, … — upstream's own states. */
  status: string | null;
  /** The version this one replaces, when it is a correction. */
  correctedVersionId: string | null;
  /** What the body wrote when filing it — on a revocation, the reason. */
  note: string | null;
}

export interface DecisionHistory {
  ada: string;
  organizationId: string | null;
  /** Oldest first, as upstream lists them. */
  versions: DecisionVersion[];
}

/**
 * Every version filed under one ΑΔΑ. A correction keeps the ΑΔΑ and adds a
 * version; a revocation adds one in `PENDING_REVOCATION` and one in `REVOKED`.
 *
 * An unknown ΑΔΑ is answered with an HTML 500, not a 404, so this cannot tell
 * "no such act" from "upstream is down". Callers check the act exists first,
 * with `fetchDecision`, which does get a proper 404.
 */
export async function fetchVersionLog(ada: string, signal: AbortSignal): Promise<DecisionHistory> {
  const body = await http.getJson<RawVersionLog>(
    `decisions/${encodeURIComponent(ada)}/versionlog.json`,
    { signal },
  );

  return {
    ada: body.ada,
    organizationId: body.organizationId ?? null,
    versions: (body.versions ?? []).map((version) => ({
      versionId: version.versionId,
      at:
        typeof version.versionTimestamp === "number"
          ? toIsoDateTime(version.versionTimestamp)
          : null,
      status: version.status ?? null,
      correctedVersionId: version.correctedVersionId ?? null,
      note: blankToNull(version.description),
    })),
  };
}

export interface DecisionTypeField {
  /** The key this value appears under in a decision's `extraFields`. */
  key: string;
  label: string | null;
  help: string | null;
  /** `string`, `integer`, `boolean`, `object`, … — upstream's own types. */
  type: string | null;
  required: boolean;
  multiple: boolean;
  /** Vocabulary the value is drawn from; look values up with search_dictionary. */
  dictionary: string | null;
  /** The closed set of values, where the field has one. */
  allowedValues: string[] | null;
  /** Lucene field for search_decisions_advanced, or null when not indexed. */
  searchField: string | null;
}

export interface DecisionTypeDetail {
  code: string;
  label: string;
  assignable: boolean;
  fields: DecisionTypeField[];
}

/**
 * What an act of one type carries beyond the common record. The detail
 * endpoint reports `parent: null` for every type, even those `types.json`
 * places in a group, so the parent is left for the caller to resolve there.
 */
export async function fetchDecisionTypeDetail(
  code: string,
  signal: AbortSignal,
): Promise<DecisionTypeDetail> {
  const raw = await getOrNotFound<RawTypeDetail>(
    `types/${encodeURIComponent(code)}/details.json`,
    signal,
    `No decision type has the code "${code}". Call list_decision_types for the valid codes.`,
    { code },
  );

  return {
    code: raw.uid,
    label: raw.label,
    assignable: raw.allowedInDecisions,
    fields: (raw.extraFields ?? []).map((field) => ({
      key: field.uid,
      label: blankToNull(field.label),
      help: blankToNull(field.help),
      type: field.type ?? null,
      required: field.required === true,
      multiple: field.multiple === true,
      dictionary: field.dictionary ?? null,
      allowedValues: field.fixedValueList && field.fixedValueList.length > 0 ? field.fixedValueList : null,
      searchField: blankToNull(field.searchTerm),
    })),
  };
}

export interface Position {
  id: string;
  label: string;
}

interface RawPositionsResponse {
  positions?: { uid: string; label: string }[] | null;
}

/**
 * Every position title in the state. Upstream lists it once per body that uses
 * it — 25,154 rows for 233 titles, 1.6 MB, ~14 s — so it is collapsed here and
 * held for a day.
 */
export async function fetchPositions(signal: AbortSignal): Promise<Position[]> {
  const body = await http.getJson<RawPositionsResponse>("positions.json", {
    signal,
    timeoutMs: 90_000,
    retries: 0,
  });

  const seen = new Map<string, Position>();
  for (const raw of body.positions ?? []) {
    if (!seen.has(raw.uid)) seen.set(raw.uid, { id: raw.uid, label: raw.label });
  }
  return [...seen.values()];
}

/** The titles one body uses. 404 on an unknown uid, unlike its units and signers. */
export async function fetchOrganizationPositions(uid: string, signal: AbortSignal): Promise<Position[]> {
  const body = await getOrNotFound<RawPositionsResponse>(
    `organizations/${encodeURIComponent(uid)}/positions.json`,
    signal,
    `No public body is registered under uid "${uid}". Search for it by name with search_organizations.`,
    { uid },
  );
  return (body.positions ?? []).map((raw) => ({ id: raw.uid, label: raw.label }));
}

/**
 * Upstream answers every unknown id with a 404. Left as a generic upstream
 * fault it would read as "try again", when in fact no number of retries will
 * make the id exist.
 */
async function getOrNotFound<T>(
  path: string,
  signal: AbortSignal,
  message: string,
  details: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await http.getJson<T>(path, { signal, ...options });
  } catch (error) {
    if (isAgoraError(error) && error.status === 404) {
      throw new NotFoundError(message, { details });
    }
    throw error;
  }
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A body with no founding Gazette reference carries "0"/""/"0", not nulls. */
function toFek(raw: RawOrganization): OrganizationDetail["fek"] {
  const number = blankToNull(raw.fekNumber);
  const year = blankToNull(raw.fekYear);
  if (!number || number === "0" || !year || year === "0") return null;
  return { number, issue: blankToNull(raw.fekIssue) ?? "", year };
}

/**
 * Open-ended validity is written as a year-3000 sentinel rather than a null, so
 * a date past the register's own horizon means "no end date" and is reported as
 * one — otherwise every serving official looks like they leave in the year 3000.
 */
const FAR_FUTURE_MS = Date.UTC(2200, 0, 1);

function toOptionalIsoDate(epochMs: number | null | undefined): string | null {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return null;
  if (epochMs >= FAR_FUTURE_MS) return null;
  return toIsoDate(epochMs);
}

/**
 * The date window upstream actually applied to `field`, read back off the
 * Lucene query it echoes.
 *
 * Upstream caps the issue-date window at 180 days and truncates anything
 * longer without saying so — asking for all of 2025 returns January to June
 * and reports a total for that half only. The requested range and the searched
 * range are therefore different things, and this is the one that is true.
 */
export function effectiveWindow(query: string, field: string): DayWindow | null {
  const pattern = new RegExp(
    `${field}:\\[DT\\((\\d{4}-\\d{2}-\\d{2})[^)]*\\) TO DT\\((\\d{4}-\\d{2}-\\d{2})[^)]*\\)\\]`,
    "u",
  );
  const match = pattern.exec(query);
  return match?.[1] && match[2] ? { from: match[1], to: match[2] } : null;
}
