import {
  cacheKey,
  createHttpClient,
  isAgoraError,
  NotFoundError,
  UpstreamError,
  pageTexts,
  readCapped,
  withCache,
  type Cache,
} from "@agoramcp/core";
import { getDocumentProxy } from "unpdf";

/**
 * The open-data face of ΚΗΜΔΗΣ, run on the ΕΣΗΔΗΣ platform. Read-only and
 * unauthenticated; the authenticated `khmdhs-api` tree next to it is for
 * bodies posting their acts, and is never touched here.
 *
 * Every search is a POST with a JSON body and a `page` query parameter. The
 * help page documents `request` and `notice`; `contract` and `payment` answer
 * the same body and are part of the same application.
 */
export const BASE_URL = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata/";

/** The register of bodies ΚΗΜΔΗΣ keys its acts by is Διαύγεια's — see `fetchOrganizationRegister`. */
const REGISTER_URL = "https://diavgeia.gov.gr/opendata/";

const http = createHttpClient({
  baseUrl: BASE_URL,
  // A search upstream has answered before comes back in 0.1-1.3 s. One it
  // has not — a body's whole month, a CPV code over 180 days — can take it
  // 15-60 s to compute the first time, after which the same body answers at
  // once; and about one cheap request in twenty stalls for exactly 60 s for
  // no reason the query explains. Upstream keeps computing after the client
  // hangs up, so giving up at 15 s and asking again collects the answer as
  // soon as it exists: measured 15-32 s where waiting would have cost 60.
  timeoutMs: 15_000,
  retries: 2,
});

const register = createHttpClient({
  baseUrl: REGISTER_URL,
  timeoutMs: 20_000,
  retries: 2,
});

/* -------------------------------------------------------------------------- */
/* Document types and ΑΔΑΜ codes                                              */
/* -------------------------------------------------------------------------- */

/** The four kinds of act the open-data API serves, in the order the law posts them. */
export type DocumentType = "request" | "notice" | "contract" | "payment";

export const DOCUMENT_TYPES: readonly DocumentType[] = ["request", "notice", "contract", "payment"];

/**
 * An ΑΔΑΜ is two digits of year, the type of act, and nine digits:
 * 26PROC019700906. `AWRD` (award decisions) is a fifth type the open-data API
 * does not serve; it is recognised so a caller gets told why, not "not found".
 */
export const ADAM = /^(\d{2})(REQ|PROC|SYMV|PAY|AWRD)(\d{9})$/u;

const TYPE_BY_INFIX: Record<string, DocumentType | "award"> = {
  REQ: "request",
  PROC: "notice",
  SYMV: "contract",
  PAY: "payment",
  AWRD: "award",
};

export function typeOfAdam(adam: string): DocumentType | "award" | null {
  const match = ADAM.exec(adam.trim().toUpperCase());
  const infix = match?.[2];
  return infix ? (TYPE_BY_INFIX[infix] ?? null) : null;
}

/* -------------------------------------------------------------------------- */
/* Upstream shapes                                                            */
/* -------------------------------------------------------------------------- */

/** How upstream writes every coded value: the code and its Greek label. */
interface RawPair {
  key?: string | number | null;
  value?: string | null;
}

interface RawItem {
  quantity?: number | null;
  type?: RawPair | null;
  costWithoutVAT?: number | null;
  /** The VAT rate as a percentage, written as a string: "24", "17", "0". */
  vat?: string | number | null;
  currency?: RawPair | null;
  shortDescription?: string | null;
  cpvs?: RawPair[] | null;
}

interface RawContracting {
  unitsOperator?: RawPair | null;
  signers?: RawPair | null;
}

interface RawFunding {
  publicFundingRef?: string | null;
  publicFundingRefNum?: string | null;
  publicFundingRefOps?: string | null;
  cofundProgramRef?: string | null;
  selfFundProgramRef?: string | null;
  espaFundProgramRef?: string | null;
  regularBudgetFundedProgramRef?: string | null;
}

/**
 * One act of any type. The four types share most of their fields and differ
 * in the rest; everything is optional here and the normaliser reads what the
 * type carries. Unknown fields pass through as `extra`.
 */
interface RawRecord {
  title?: string | null;
  referenceNumber?: string | null;
  submissionDate?: string | null;
  lastUpdateDate?: string | null;
  signedDate?: string | null;
  publishedDate?: string | null;
  finalSubmissionDate?: string | null;
  cancelled?: boolean | null;
  cancellationDate?: string | null;
  cancellationType?: string | null;
  cancellationReason?: string | null;
  cancellationADA?: string | null;
  protocolNumber?: string | null;
  aaht?: string | null;
  organization?: RawPair | null;
  organizationVatNumber?: string | null;
  contractingData?: RawContracting | null;
  contractingDataDetails?: RawContracting | null;
  nutsCode?: RawPair | null;
  nutsCodes?: { nutsCode?: RawPair | null }[] | null;
  nutsCity?: string | null;
  nutsPostalCode?: string | null;
  nutsCountry?: RawPair | null;
  contractType?: RawPair | null;
  contractTypes?: { contractType?: RawPair | null }[] | null;
  additionalContractTypes?: { additionalContractType?: RawPair | null }[] | null;
  mixedContract?: boolean | null;
  typeOfProcedure?: RawPair | null;
  procedureType?: RawPair | null;
  awardProcedure?: RawPair | null;
  criteriaCode?: RawPair | null;
  assignCriteria?: RawPair | null;
  legalContext?: RawPair | null;
  conductingProceedings?: RawPair | null;
  digitalPlatform?: RawPair | null;
  classificationOfPublicLawOrganization?: RawPair | null;
  typeOfContractingAuthority?: RawPair | null;
  contractingAuthorities?: { contractingAuthority?: RawPair | null }[] | null;
  contractingAuthorityActivity?: RawPair | null;
  centralizedMarkets?: { centralizedMarket?: RawPair | null }[] | null;
  centralGovernmentAuthority?: RawPair | null;
  socialContract?: RawPair | null;
  assignedContract?: RawPair | null;
  budget?: number | null;
  commitmentNo?: string | null;
  fundingDetails?: RawFunding | null;
  totalCostWithVAT?: number | null;
  totalCostWithoutVAT?: number | null;
  objectDetails?: RawItem[] | null;
  objectDetailsList?: RawItem[] | null;
  /* links between acts, written differently per type */
  previousRequestReferenceNumber?: string | null;
  approvalRefNo?: string[] | null;
  noticeRefNo?: string[] | null;
  contractRefNo?: string | string[] | null;
  paymentRefNo?: string | string[] | null;
  requestRefNo?: string | string[] | null;
  auctionRefNo?: string | string[] | null;
  approvedRequests?: { code?: string | null }[] | null;
  approvedRequestsList?: { code?: string | null }[] | null;
  amendsNoticeRefNo?: string[] | null;
  amendedNoticeADAM?: string | null;
  frameworkAgreementNoticeADAM?: string | null;
  relatedNoticeADAM?: string | null;
  noticeReferenceNumber?: string | null;
  prevReferenceNo?: string | null;
  nextRefNo?: string | null;
  nextExtended?: boolean | null;
  nextModified?: boolean | null;
  /* links to Διαύγεια */
  approvalADA?: string | null;
  approvalCommitmentCode?: string | null;
  paymentCommitmentCode?: string | null;
  paymentRelatedAda?: string | null;
  decisionRelatedAda?: string | null;
  diavgeiaADA?: string | null;
  contractRelatedADA?: { number1?: string | null; number2?: string | null; number3?: string | null } | null;
  /* request */
  procurementDeliveryDate?: string | null;
  approved?: boolean | null;
  preApproval?: boolean | null;
  /* notice */
  noticeType?: RawPair | null;
  amendPreviousNotice?: boolean | null;
  numberOfSections?: number | null;
  offersValidTime?: number | null;
  offersValidTimeUnitOfMeasure?: RawPair | null;
  contractDuration?: number | null;
  contractDurationUnitOfMeasure?: RawPair | null;
  biddingWebsite?: string | null;
  systemicNumbers?: { systemicNumber?: string | null }[] | null;
  maxNumberOfContractors?: number | null;
  optionRight?: RawPair | null;
  optionRightDescription?: string | null;
  abortReason?: string | null;
  /* contract */
  contractSignedDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  noEndDate?: boolean | null;
  contractNumber?: string | null;
  contractBudget?: number | null;
  bidsSubmitted?: number | null;
  maxBidsSubmitted?: number | null;
  /* payment */
  credit?: boolean | null;
  [key: string]: unknown;
}

interface RawPage {
  content?: RawRecord[] | null;
  totalElements?: number | null;
  totalPages?: number | null;
  size?: number | null;
  number?: number | null;
  numberOfElements?: number | null;
}

interface RawOrganization {
  uid: string;
  label: string;
  abbreviation?: string | null;
  vatNumber?: string | null;
  category?: string | null;
  status?: string | null;
}

interface RawOrganizationsResponse {
  organizations?: RawOrganization[] | null;
}

/* -------------------------------------------------------------------------- */
/* Normalised shapes                                                          */
/* -------------------------------------------------------------------------- */

/** A coded value with the label upstream attaches to it. */
export interface Code {
  code: string;
  label: string | null;
}

/** A body, unit or official from the shared register, by its uid. */
export interface Party {
  id: string | null;
  name: string | null;
}

export interface Money {
  withVat: number | null;
  withoutVat: number | null;
}

export interface LineItem {
  description: string | null;
  quantity: number | null;
  /** Unit of measure: `Τεμάχιο`, `Υπηρεσία`, `Μελέτη`, … */
  unit: Code | null;
  costWithoutVat: number | null;
  /** The VAT rate applied, as a percentage. */
  vatPercent: number | null;
  currency: string | null;
  cpvs: Code[];
}

export interface Cancellation {
  at: string | null;
  type: string | null;
  reason: string | null;
  /** The Διαύγεια act that cancelled it, where one was cited. */
  ada: string | null;
}

/** What a search returns per act: enough to pick one, no more. */
export interface DocumentSummary {
  type: DocumentType;
  adam: string;
  title: string;
  organization: Party & { vatNumber: string | null };
  /** When the act was posted to ΚΗΜΔΗΣ — the date the searches filter on. Athens time. */
  submittedAt: string | null;
  /** When the act was signed by the body. */
  signedOn: string | null;
  cancelled: boolean;
  region: Code | null;
  contractType: Code | null;
  /** Notices and contracts: how the contract is or was awarded. */
  procedureType: Code | null;
  /** Notices: `Προκήρυξη`, `Διακήρυξη` or `Πρόσκληση`. */
  noticeType: Code | null;
  /** Notices: when offers must be in. Athens time. */
  deadline: string | null;
  total: Money;
  /** Every CPV across the act's items. */
  cpvs: Code[];
  /** The signed PDF. */
  documentUrl: string;
}

/** Links to the other acts in the same procurement, and to Διαύγεια. */
export interface Links {
  /** Requests: the request this one replaces; contracts: the contract this one amends. */
  previous: string | null;
  /** Contracts: the amendment or extension that superseded this one. */
  next: { adam: string; extended: boolean; modified: boolean } | null;
  requests: string[];
  approvals: string[];
  notices: string[];
  contracts: string[];
  payments: string[];
  /** Award decisions (`AWRD`), which the open-data API does not serve. */
  awards: string[];
  amendedNotice: string | null;
  frameworkNotice: string | null;
  /** ΑΔΑ codes on Διαύγεια, by what the act cites them for. */
  diavgeia: {
    commitment: string | null;
    approval: string | null;
    decision: string | null;
    contract: string[];
    payment: string | null;
    other: string | null;
  };
}

export interface Funding {
  publicFundingRef: string | null;
  publicFundingRefNum: string | null;
  publicFundingRefOps: string | null;
  cofundProgramRef: string | null;
  selfFundProgramRef: string | null;
  espaFundProgramRef: string | null;
  /** Budget line(s) of the regular budget the act is charged to. */
  regularBudgetRef: string | null;
}

export interface Document extends DocumentSummary {
  updatedAt: string | null;
  cancellation: Cancellation | null;
  unit: Party | null;
  signer: Party | null;
  city: string | null;
  postCode: string | null;
  country: Code | null;
  regions: Code[];
  /** Every contract type the act carries; the first is `contractType`. */
  contractTypes: Code[];
  mixedContract: boolean | null;
  awardProcedure: Code | null;
  criteria: Code | null;
  legalContext: Code | null;
  conducting: Code | null;
  digitalPlatform: Code | null;
  authorityType: Code | null;
  classification: Code | null;
  activity: Code | null;
  centralizedMarkets: Code[];
  centralGovernment: boolean | null;
  socialContract: boolean | null;
  assignedContract: boolean | null;
  /** The body's own file reference (ΑΑΗΤ). */
  aaht: string | null;
  protocolNumber: string | null;
  budget: number | null;
  commitmentNo: string | null;
  funding: Funding | null;
  items: LineItem[];
  links: Links;
  request: {
    deliveryDate: string | null;
    /** Whether this record is the approval of a request rather than the request itself. */
    approved: boolean | null;
    preApproval: boolean | null;
    approvalCommitmentCode: string | null;
  } | null;
  notice: {
    publishedAt: string | null;
    sections: number | null;
    amendsPrevious: boolean;
    offersValid: { amount: number | null; unit: Code | null };
    duration: { amount: number | null; unit: Code | null };
    biddingWebsite: string | null;
    /** ΕΣΗΔΗΣ system numbers of the tender. */
    systemicNumbers: string[];
    maxContractors: number | null;
    optionRight: { allowed: boolean | null; description: string | null };
    abortReason: string | null;
  } | null;
  contract: {
    contractNumber: string | null;
    startsOn: string | null;
    endsOn: string | null;
    openEnded: boolean;
    duration: { amount: number | null; unit: Code | null };
    contractBudget: number | null;
    bidsSubmitted: number | null;
    maxBids: number | null;
  } | null;
  payment: {
    /** A credit note rather than a payment. */
    credit: boolean;
  } | null;
  /** Fields this adapter does not map, verbatim. */
  extra: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Searching                                                                  */
/* -------------------------------------------------------------------------- */

export type RequestKind = "initial" | "approval" | "all";

export interface SearchQuery {
  type: DocumentType;
  title?: string | undefined;
  referenceNumber?: string | undefined;
  organizationId?: string | undefined;
  signerId?: string | undefined;
  cpv?: string | undefined;
  contractType?: string | undefined;
  procedureType?: string | undefined;
  submittedFrom?: string | undefined;
  submittedTo?: string | undefined;
  cancelledFrom?: string | undefined;
  cancelledTo?: string | undefined;
  deadlineFrom?: string | undefined;
  deadlineTo?: string | undefined;
  amendmentsOnly?: boolean | undefined;
  requestKind?: RequestKind | undefined;
  aaht?: string | undefined;
  fundingReference?: string | undefined;
  page: number;
}

export interface SearchPage {
  page: number;
  /** Fixed by upstream at 50. */
  size: number;
  total: number;
  totalPages: number;
  documents: DocumentSummary[];
}

/**
 * Upstream's window on submission dates. Longer than this and the range is
 * cut to the 180 days ending at `dateTo` — the *last* 180, where Διαύγεια
 * keeps the first. One bound alone means 180 days from it; none means the
 * last 180 days. All measured, none documented.
 */
export const MAX_WINDOW_DAYS = 180;

export interface DayWindow {
  from: string;
  to: string;
}

/**
 * The window upstream will actually search, given what was asked. Upstream
 * does not echo it, so it is computed by the rules above.
 */
export function effectiveWindow(
  from: string | undefined,
  to: string | undefined,
  today: string = todayInAthens(),
): DayWindow & { truncated: boolean; defaulted: boolean } {
  if (from !== undefined && to !== undefined) {
    if (daysBetween(from, to) > MAX_WINDOW_DAYS) {
      return { from: addDays(to, -MAX_WINDOW_DAYS), to, truncated: true, defaulted: false };
    }
    return { from, to, truncated: false, defaulted: false };
  }
  if (from !== undefined) {
    const end = addDays(from, MAX_WINDOW_DAYS);
    return { from, to: end < today ? end : today, truncated: false, defaulted: false };
  }
  if (to !== undefined) {
    return { from: addDays(to, -MAX_WINDOW_DAYS), to, truncated: false, defaulted: false };
  }
  return { from: addDays(today, -MAX_WINDOW_DAYS), to: today, truncated: false, defaulted: true };
}

/** The JSON body upstream expects, from the normalised query. */
export function buildBody(query: SearchQuery): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") body[key] = value;
  };

  set("title", query.title);
  set("referenceNumber", query.referenceNumber?.toUpperCase());
  if (query.organizationId !== undefined) body.organizations = [Number(query.organizationId)];
  if (query.signerId !== undefined) body.signer = Number(query.signerId);
  if (query.cpv !== undefined) body.cpvItems = [query.cpv];
  set("contractType", query.contractType);
  if (query.procedureType !== undefined) body.procedureType = Number(query.procedureType);
  set("dateFrom", query.submittedFrom);
  set("dateTo", query.submittedTo);
  set("cancelDateFrom", query.cancelledFrom);
  set("cancelDateTo", query.cancelledTo);
  // These two want a time, in the one format upstream parses.
  if (query.deadlineFrom !== undefined) body.finalDateFrom = `${query.deadlineFrom} 00:00`;
  if (query.deadlineTo !== undefined) body.finalDateTo = `${query.deadlineTo} 23:59`;
  if (query.amendmentsOnly) body.isModified = true;
  set("aaht", query.aaht);
  set("publicFundingRefNum", query.fundingReference);

  // A request record is either the request itself or the approval of one;
  // upstream serves both unless told which to leave out.
  if (query.requestKind === "initial") body.isApproval = false;
  if (query.requestKind === "approval") body.isInitial = false;

  return body;
}

/**
 * One page of one type of act. An empty result is a 404 upstream — the same
 * answer as a page past the end — and is returned here as an empty page,
 * because "nothing matched" is an answer, not a failure.
 */
export async function search(query: SearchQuery, signal: AbortSignal): Promise<SearchPage> {
  let body: RawPage;
  try {
    body = await http.getJson<RawPage>(query.type, {
      method: "POST",
      query: { page: query.page },
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody(query)),
      signal,
    });
  } catch (error) {
    if (isAgoraError(error) && error.status === 404) {
      return { page: query.page, size: PAGE_SIZE, total: 0, totalPages: 0, documents: [] };
    }
    throw error;
  }

  return {
    page: body.number ?? query.page,
    size: body.size ?? PAGE_SIZE,
    total: body.totalElements ?? 0,
    totalPages: body.totalPages ?? 0,
    documents: (body.content ?? []).map((raw) => toSummary(query.type, raw)),
  };
}

/** Upstream pages by 50 and offers no way to change it. */
export const PAGE_SIZE = 50;

/**
 * One act by its ΑΔΑΜ, whichever type it is. The API has no fetch-by-id; a
 * search on `referenceNumber` alone returns exactly the one act, or a 404.
 */
export async function fetchDocument(adam: string, signal: AbortSignal): Promise<Document> {
  const code = adam.trim().toUpperCase();
  const type = typeOfAdam(code);

  if (type === "award") {
    throw new NotFoundError(
      `${code} is an award decision (AWRD). The open-data API serves requests, notices, contracts and payments, not awards; the contract that followed it cites it under links.awards.`,
      { details: { adam: code } },
    );
  }
  if (type === null) {
    throw new NotFoundError(
      `"${adam}" is not an ΑΔΑΜ. One looks like 26PROC019700906: two digits of year, REQ, PROC, SYMV or PAY, then nine digits.`,
      { details: { adam } },
    );
  }

  let body: RawPage;
  try {
    body = await http.getJson<RawPage>(type, {
      method: "POST",
      query: { page: 0 },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referenceNumber: code }),
      signal,
    });
  } catch (error) {
    if (isAgoraError(error) && error.status === 404) throw notFound(code);
    throw error;
  }

  const raw = (body.content ?? []).find((entry) => entry.referenceNumber?.toUpperCase() === code);
  if (!raw) throw notFound(code);
  return toDocument(type, raw);
}

function notFound(code: string): NotFoundError {
  return new NotFoundError(
    `No act is registered under ΑΔΑΜ "${code}". Check the code, or search for the act instead.`,
    { details: { adam: code } },
  );
}

/* -------------------------------------------------------------------------- */
/* The signed PDF                                                             */
/* -------------------------------------------------------------------------- */

/** Bounded: a tender with its annexes can be large, and is held in memory whole. */
const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

export function documentUrl(type: DocumentType, adam: string): string {
  return `${BASE_URL}${type}/attachment/${encodeURIComponent(adam)}`;
}

export async function fetchAttachment(type: DocumentType, adam: string, signal: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await http.request(`${type}/attachment/${encodeURIComponent(adam)}`, {
      signal,
      // Measured 0.2 s; the same stall as the searches hits this endpoint too.
      timeoutMs: 20_000,
      headers: { accept: "*/*" },
    });
  } catch (error) {
    if (isAgoraError(error) && error.status === 404) {
      throw new NotFoundError(`No PDF is published for ΑΔΑΜ "${adam}".`, { details: { adam } });
    }
    throw error;
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(type, adam, declared);
  }

  if (!(response.headers.get("content-type") ?? "").includes("application/pdf")) {
    await response.body?.cancel().catch(() => undefined);
    throw new NotFoundError(`No PDF is published for ΑΔΑΜ "${adam}".`, { details: { adam } });
  }

  // Counted as it arrives: a length header is a claim, and a chunked answer makes none.
  const bytes = await readCapped(response, MAX_DOCUMENT_BYTES);
  if (!bytes) throw tooLarge(type, adam);
  return bytes;
}

/** `bytes` when the server declared them; a body cut off at the cap only says it was over. */
function tooLarge(type: DocumentType, adam: string, bytes?: number): UpstreamError {
  const size = bytes === undefined ? `over ${MAX_DOCUMENT_BYTES / 1_048_576} MB` : `${Math.round(bytes / 1_048_576)} MB`;
  return new UpstreamError(
    `The PDF for ΑΔΑΜ "${adam}" is ${size} — too large to read here. It can be downloaded from ${documentUrl(type, adam)}.`,
    { status: 413, details: { adam, ...(bytes === undefined ? {} : { bytes }) } },
  );
}

export interface DocumentText {
  pageCount: number;
  /** One entry per page, in order, whitespace tidied. Empty where a page has no text layer. */
  pages: string[];
}

/**
 * The text layer of a PDF, page by page. A scanned act yields empty pages,
 * not an error. Stops between pages once `signal` aborts.
 */
export async function extractDocumentText(bytes: Uint8Array, signal: AbortSignal): Promise<DocumentText> {
  // Quiet: pdf.js reports every oddity in a signed government PDF to the console.
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const pages = await pageTexts(pdf, signal);
    return { pageCount: pages.length, pages: pages.map(tidyText) };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function tidyText(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/gu, " ")
    .replace(/ ?\n ?/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* The register of bodies                                                     */
/* -------------------------------------------------------------------------- */

/** A register row, trimmed to what identifies a body in a list of matches. */
export interface OrganizationMatch {
  id: string;
  name: string;
  abbreviation: string | null;
  vatNumber: string | null;
  category: string | null;
  status: string | null;
}

/**
 * ΚΗΜΔΗΣ keys bodies, units and signers by the uids of the state's shared
 * register of bodies (Μητρώο Φορέων), the same register Διαύγεια publishes:
 * every organisation, unit and signer id on a ΚΗΜΔΗΣ act resolved on
 * Διαύγεια's endpoints in testing. ΚΗΜΔΗΣ itself has no lookup — the
 * `organizations` filter wants a uid and nothing turns a name into one — so
 * the register is read from Διαύγεια, which serves it whole: 5,838 bodies,
 * 2.7 MB, about 19 s.
 */
export async function fetchOrganizationRegister(signal: AbortSignal): Promise<OrganizationMatch[]> {
  const body = await register.getJson<RawOrganizationsResponse>("organizations.json", {
    query: { status: "all" },
    signal,
    timeoutMs: 90_000,
    retries: 0,
  });

  return (body.organizations ?? []).map((raw) => ({
    id: raw.uid,
    name: raw.label,
    abbreviation: blankToNull(raw.abbreviation),
    vatNumber: blankToNull(raw.vatNumber),
    category: blankToNull(raw.category),
    status: blankToNull(raw.status),
  }));
}

export const REGISTER_TTL_SECONDS = 86_400;
const REGISTER_HOLD_SECONDS = 7 * 86_400;
const REGISTER_KEY = cacheKey("gr/kimdis:organization_register", "all");

interface HeldRegister {
  fetchedAt: number;
  organizations: OrganizationMatch[];
}

let refreshing: Promise<void> | null = null;

/**
 * The register, held a week and refreshed in the background once a day old,
 * so the 19 s is paid at boot by `warm` and never by a caller who found a
 * copy in hand. A host without a boot pays it on the first name search.
 */
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

function refreshRegister(cache: Cache): void {
  if (refreshing) return;
  refreshing = fetchOrganizationRegister(AbortSignal.timeout(180_000))
    .then((organizations) =>
      cache.set(REGISTER_KEY, { fetchedAt: Date.now(), organizations }, REGISTER_HOLD_SECONDS),
    )
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                              */
/* -------------------------------------------------------------------------- */

function toSummary(type: DocumentType, raw: RawRecord): DocumentSummary {
  const adam = (raw.referenceNumber ?? "").toUpperCase();
  const items = raw.objectDetails ?? raw.objectDetailsList ?? [];
  const contractTypes = allContractTypes(raw);

  return {
    type,
    adam,
    title: blankToNull(raw.title) ?? "",
    organization: {
      id: pairKey(raw.organization),
      name: pairLabel(raw.organization),
      vatNumber: blankToNull(raw.organizationVatNumber),
    },
    submittedAt: toDateTime(raw.submissionDate),
    signedOn: toDate(raw.contractSignedDate ?? raw.signedDate),
    cancelled: raw.cancelled === true,
    region: code(raw.nutsCode),
    contractType: contractTypes[0] ?? null,
    procedureType: code(raw.typeOfProcedure ?? raw.procedureType),
    noticeType: code(raw.noticeType),
    deadline: type === "notice" ? toDateTime(raw.finalSubmissionDate) : null,
    total: { withVat: num(raw.totalCostWithVAT), withoutVat: num(raw.totalCostWithoutVAT) },
    cpvs: uniqueCodes(items.flatMap((item) => (item.cpvs ?? []).map(code))),
    documentUrl: documentUrl(type, adam),
  };
}

/** Keys of a record the summary and the detail read; the rest is `extra`. */
const MAPPED_KEYS = new Set([
  "title", "referenceNumber", "submissionDate", "lastUpdateDate", "signedDate", "publishedDate",
  "finalSubmissionDate", "cancelled", "cancellationDate", "cancellationType", "cancellationReason",
  "cancellationADA", "protocolNumber", "aaht", "organization", "organizationVatNumber",
  "greekOrganizationVatNumber", "authorEmail", "contractingData", "contractingDataDetails",
  "nutsCode", "nutsCodes", "nutsCity", "nutsPostalCode", "nutsCountry", "contractType",
  "contractTypes", "additionalContractTypes", "mixedContract", "typeOfProcedure", "procedureType",
  "awardProcedure", "criteriaCode", "assignCriteria", "legalContext", "conductingProceedings",
  "digitalPlatform", "classificationOfPublicLawOrganization", "typeOfContractingAuthority",
  "contractingAuthorities", "contractingAuthorityActivity", "centralizedMarkets",
  "centralGovernmentAuthority", "socialContract", "assignedContract", "budget", "commitmentNo",
  "fundingDetails", "totalCostWithVAT", "totalCostWithoutVAT", "objectDetails", "objectDetailsList",
  "previousRequestReferenceNumber", "approvalRefNo", "noticeRefNo", "contractRefNo", "paymentRefNo",
  "requestRefNo", "auctionRefNo", "auctionReferenceNumber", "approvedRequests", "approvedRequestsList",
  "amendsNoticeRefNo", "amendedNoticeADAM", "frameworkAgreementNoticeADAM", "relatedNoticeADAM",
  "noticeReferenceNumber", "prevReferenceNo", "nextRefNo", "nextExtended", "nextModified",
  "approvalADA", "approvalCommitmentCode", "paymentCommitmentCode", "paymentRelatedAda",
  "decisionRelatedAda", "diavgeiaADA", "contractRelatedADA", "procurementDeliveryDate", "approved",
  "preApproval", "noticeType", "amendPreviousNotice", "numberOfSections", "offersValidTime",
  "offersValidTimeUnitOfMeasure", "contractDuration", "contractDurationUnitOfMeasure",
  "biddingWebsite", "systemicNumbers", "maxNumberOfContractors", "optionRight",
  "optionRightDescription", "abortReason", "contractSignedDate", "startDate", "endDate", "noEndDate",
  "contractNumber", "contractBudget", "bidsSubmitted", "maxBidsSubmitted", "credit",
]);

function toDocument(type: DocumentType, raw: RawRecord): Document {
  const summary = toSummary(type, raw);
  const contracting = raw.contractingData ?? raw.contractingDataDetails ?? null;
  const items = raw.objectDetails ?? raw.objectDetailsList ?? [];
  const funding = raw.fundingDetails ?? null;

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!MAPPED_KEYS.has(key) && value !== null && value !== undefined) extra[key] = value;
  }

  return {
    ...summary,
    updatedAt: toDateTime(raw.lastUpdateDate),
    cancellation:
      raw.cancelled === true || raw.cancellationDate || raw.cancellationReason
        ? {
            at: toDateTime(raw.cancellationDate),
            type: blankToNull(raw.cancellationType),
            reason: blankToNull(raw.cancellationReason),
            ada: blankToNull(raw.cancellationADA),
          }
        : null,
    unit: party(contracting?.unitsOperator),
    signer: party(contracting?.signers),
    city: blankToNull(raw.nutsCity),
    postCode: blankToNull(raw.nutsPostalCode),
    country: code(raw.nutsCountry),
    regions: uniqueCodes((raw.nutsCodes ?? []).map((entry) => code(entry.nutsCode))),
    contractTypes: allContractTypes(raw),
    mixedContract: typeof raw.mixedContract === "boolean" ? raw.mixedContract : null,
    awardProcedure: code(raw.awardProcedure),
    criteria: code(raw.criteriaCode ?? raw.assignCriteria),
    legalContext: code(raw.legalContext),
    conducting: code(raw.conductingProceedings),
    digitalPlatform: code(raw.digitalPlatform),
    authorityType:
      code(raw.typeOfContractingAuthority) ??
      code(raw.contractingAuthorities?.[0]?.contractingAuthority),
    classification: code(raw.classificationOfPublicLawOrganization),
    activity: code(raw.contractingAuthorityActivity),
    centralizedMarkets: uniqueCodes((raw.centralizedMarkets ?? []).map((entry) => code(entry.centralizedMarket))),
    centralGovernment: yesNo(raw.centralGovernmentAuthority),
    socialContract: yesNo(raw.socialContract),
    assignedContract: yesNo(raw.assignedContract),
    aaht: blankToNull(raw.aaht),
    protocolNumber: blankToNull(raw.protocolNumber),
    budget: num(raw.budget),
    commitmentNo: blankToNull(raw.commitmentNo),
    funding: funding
      ? {
          publicFundingRef: blankToNull(funding.publicFundingRef),
          publicFundingRefNum: blankToNull(funding.publicFundingRefNum),
          publicFundingRefOps: blankToNull(funding.publicFundingRefOps),
          cofundProgramRef: blankToNull(funding.cofundProgramRef),
          selfFundProgramRef: blankToNull(funding.selfFundProgramRef),
          espaFundProgramRef: blankToNull(funding.espaFundProgramRef),
          regularBudgetRef: blankToNull(funding.regularBudgetFundedProgramRef),
        }
      : null,
    items: items.map((item) => ({
      description: blankToNull(item.shortDescription),
      quantity: num(item.quantity),
      unit: code(item.type),
      costWithoutVat: num(item.costWithoutVAT),
      vatPercent: num(item.vat),
      currency: pairKey(item.currency),
      cpvs: uniqueCodes((item.cpvs ?? []).map(code)),
    })),
    links: toLinks(type, raw),
    request:
      type === "request"
        ? {
            deliveryDate: toDate(raw.procurementDeliveryDate),
            approved: typeof raw.approved === "boolean" ? raw.approved : null,
            preApproval: typeof raw.preApproval === "boolean" ? raw.preApproval : null,
            approvalCommitmentCode: blankToNull(raw.approvalCommitmentCode),
          }
        : null,
    notice:
      type === "notice"
        ? {
            publishedAt: toDateTime(raw.publishedDate),
            sections: num(raw.numberOfSections),
            amendsPrevious: raw.amendPreviousNotice === true,
            offersValid: { amount: num(raw.offersValidTime), unit: code(raw.offersValidTimeUnitOfMeasure) },
            duration: { amount: num(raw.contractDuration), unit: code(raw.contractDurationUnitOfMeasure) },
            biddingWebsite: blankToNull(raw.biddingWebsite),
            systemicNumbers: (raw.systemicNumbers ?? []).flatMap((entry) => {
              const value = blankToNull(entry.systemicNumber);
              return value ? [value] : [];
            }),
            maxContractors: num(raw.maxNumberOfContractors),
            optionRight: { allowed: yesNo(raw.optionRight), description: blankToNull(raw.optionRightDescription) },
            abortReason: blankToNull(raw.abortReason),
          }
        : null,
    contract:
      type === "contract"
        ? {
            contractNumber: blankToNull(raw.contractNumber) === "-" ? null : blankToNull(raw.contractNumber),
            startsOn: toDate(raw.startDate),
            endsOn: toDate(raw.endDate),
            openEnded: raw.noEndDate === true,
            duration: { amount: num(raw.contractDuration), unit: code(raw.contractDurationUnitOfMeasure) },
            contractBudget: num(raw.contractBudget),
            bidsSubmitted: num(raw.bidsSubmitted),
            maxBids: num(raw.maxBidsSubmitted),
          }
        : null,
    payment: type === "payment" ? { credit: raw.credit === true } : null,
    extra,
  };
}

/**
 * The same link is written under a different name on each type of act —
 * `noticeRefNo` on a request, `noticeReferenceNumber` on a contract,
 * `amendedNoticeADAM` on a notice — and sometimes as a string, sometimes a
 * list. Collected here by what the linked act *is*, so a reader follows the
 * procurement from request to payment without learning the field names.
 */
function toLinks(type: DocumentType, raw: RawRecord): Links {
  const contractAdas = [
    raw.contractRelatedADA?.number1,
    raw.contractRelatedADA?.number2,
    raw.contractRelatedADA?.number3,
  ].flatMap((value) => {
    const ada = blankToNull(value);
    return ada ? [ada] : [];
  });

  return {
    previous: blankToNull(raw.previousRequestReferenceNumber) ?? blankToNull(raw.prevReferenceNo),
    next: blankToNull(raw.nextRefNo)
      ? {
          adam: raw.nextRefNo as string,
          extended: raw.nextExtended === true,
          modified: raw.nextModified === true,
        }
      : null,
    requests: uniqueStrings([
      ...refs(raw.requestRefNo),
      ...(raw.approvedRequests ?? []).map((entry) => entry.code),
      ...(raw.approvedRequestsList ?? []).map((entry) => entry.code),
    ]),
    approvals: uniqueStrings(refs(raw.approvalRefNo)),
    notices: uniqueStrings([
      ...refs(raw.noticeRefNo),
      raw.noticeReferenceNumber,
      raw.relatedNoticeADAM,
      ...(type === "notice" ? refs(raw.amendsNoticeRefNo) : []),
    ]),
    contracts: uniqueStrings(refs(raw.contractRefNo)),
    payments: uniqueStrings(refs(raw.paymentRefNo)),
    awards: uniqueStrings([...refs(raw.auctionRefNo), raw.auctionReferenceNumber as string | null | undefined]),
    amendedNotice: blankToNull(raw.amendedNoticeADAM),
    frameworkNotice: blankToNull(raw.frameworkAgreementNoticeADAM),
    diavgeia: {
      commitment: blankToNull(raw.paymentCommitmentCode) ?? blankToNull(raw.approvalCommitmentCode),
      approval: blankToNull(raw.approvalADA),
      decision: blankToNull(raw.decisionRelatedAda),
      contract: contractAdas,
      payment: blankToNull(raw.paymentRelatedAda),
      other: blankToNull(raw.diavgeiaADA),
    },
  };
}

/** Requests list their contract types; the other acts carry one plus "additional" ones. */
function allContractTypes(raw: RawRecord): Code[] {
  return uniqueCodes([
    code(raw.contractType),
    ...(raw.contractTypes ?? []).map((entry) => code(entry.contractType)),
    ...(raw.additionalContractTypes ?? []).map((entry) => code(entry.additionalContractType)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function pairKey(pair: RawPair | null | undefined): string | null {
  const key = pair?.key;
  if (typeof key === "number") return String(key);
  return blankToNull(key);
}

function pairLabel(pair: RawPair | null | undefined): string | null {
  return blankToNull(pair?.value);
}

function code(pair: RawPair | null | undefined): Code | null {
  const value = pairKey(pair);
  return value === null ? null : { code: value, label: pairLabel(pair) };
}

function party(pair: RawPair | null | undefined): Party | null {
  const id = pairKey(pair);
  const name = pairLabel(pair);
  return id === null && name === null ? null : { id, name };
}

/** Upstream writes booleans as coded `Ναι`/`Όχι` pairs. */
function yesNo(pair: RawPair | null | undefined): boolean | null {
  const key = pairKey(pair);
  if (key === "1") return true;
  if (key === "2") return false;
  return null;
}

function refs(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => (blankToNull(entry) ? [entry.trim()] : []));
  const single = blankToNull(value);
  return single ? [single] : [];
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = blankToNull(value);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function uniqueCodes(values: readonly (Code | null)[]): Code[] {
  const out: Code[] = [];
  for (const value of values) {
    if (value && !out.some((entry) => entry.code === value.code)) out.push(value);
  }
  return out;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Upstream writes timestamps without a zone — `2026-08-31T23:45:40.871` —
 * and they are Athens wall-clock time. Kept as such, to the second, rather
 * than converted to a UTC that would misplace an act posted late at night on
 * the following day.
 */
function toDateTime(value: string | null | undefined): string | null {
  const text = blankToNull(value);
  if (!text) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/u.exec(text);
  if (!match) return text;
  return `${match[1]}T${match[2]}:${match[3] ?? "00"}`;
}

function toDate(value: string | null | undefined): string | null {
  const text = blankToNull(value);
  return text ? text.slice(0, 10) : null;
}

const ATHENS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Athens",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
