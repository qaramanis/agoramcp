import {
  cacheKey,
  createHttpClient,
  isAgoraError,
  NotFoundError,
  withCache,
  type Cache,
  type QueryParams,
} from "@agoramcp/core";

/**
 * The OpenData tree is read-only and unauthenticated. The authenticated half of
 * Diavgeia lives under `/api` and is for publishing bodies — we never touch it.
 */
export const BASE_URL = "https://diavgeia.gov.gr/opendata/";

/** Upstream caps a page at 500 regardless of what you ask for. */
export const MAX_UPSTREAM_PAGE_SIZE = 500;

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

export interface RawDecision {
  ada: string;
  subject: string;
  protocolNumber?: string | null;
  /** Epoch milliseconds at UTC midnight of the issue date. */
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
  attachments?: unknown[] | null;
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

export interface DecisionDetail extends DecisionSummary {
  versionId: string;
  documentChecksum: string | null;
  attachmentCount: number;
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

export interface SearchQuery {
  subject?: string | undefined;
  text?: string | undefined;
  organizationId?: string | undefined;
  unitId?: string | undefined;
  signerId?: string | undefined;
  decisionType?: string | undefined;
  thematicCategory?: string | undefined;
  issuedFrom?: string | undefined;
  issuedTo?: string | undefined;
  includeRevoked?: boolean | undefined;
  page: number;
  size: number;
}

export interface SearchResult {
  info: RawSearchInfo;
  decisions: DecisionSummary[];
}

/**
 * Upstream parameter names are neither guessable nor documented in the portal:
 * `term` is full text, `subject` is the subject line only, and a plain `q` is
 * accepted and then silently ignored. This map is the whole translation layer.
 */
export async function searchDecisions(
  query: SearchQuery,
  signal: AbortSignal,
): Promise<SearchResult> {
  const params: QueryParams = {
    size: query.size,
    page: query.page,
    subject: query.subject,
    term: query.text,
    org: query.organizationId,
    unit: query.unitId,
    signer: query.signerId,
    type: query.decisionType,
    tag: query.thematicCategory,
    from_issue_date: query.issuedFrom,
    to_issue_date: query.issuedTo,
    // Omitted entirely unless asked for: the upstream default already excludes
    // revoked acts, and sending the default back changes nothing.
    ...(query.includeRevoked ? { status: "all" } : {}),
  };

  const body = await http.getJson<RawSearchResponse>("search.json", { query: params, signal });
  const decisions = (body.decisions ?? []).map(toSummary);

  return { info: body.info, decisions };
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
  const unique = [...new Set(ids)];
  const resolved = new Map<string, Organization>();

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

function toIsoDate(epochMs: number): string {
  const iso = toIsoDateTime(epochMs);
  return iso.slice(0, 10);
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
  supervisorName: string | null;
}

/** Bodies and vocabularies change on the order of years, not minutes. */
export const REGISTER_TTL_SECONDS = 86_400;

/**
 * The whole register in one document: 5,421 active bodies, 2.5 MB, 17-19 s.
 *
 * Upstream has no name search — `organizations.json` ignores every filter
 * parameter and returns the lot regardless — so searching by name means holding
 * the register and matching locally. That is only tolerable because it is
 * cached for a day: the first caller of the day waits, everyone after pays
 * nothing.
 *
 * The timeout is raised for this one call. Measured at 17-19 s, it sits inside
 * the shared client's 20 s budget by luck rather than by margin.
 */
export async function fetchOrganizationRegister(signal: AbortSignal): Promise<OrganizationMatch[]> {
  const body = await http.getJson<RawOrganizationsResponse>("organizations.json", {
    signal,
    timeoutMs: 60_000,
    // A retry means another 2.5 MB and another 19 s. One attempt is enough.
    retries: 0,
  });

  return (body.organizations ?? []).map((raw) => ({
    id: raw.uid,
    name: raw.label,
    abbreviation: raw.abbreviation ?? null,
    vatNumber: raw.vatNumber ?? null,
    category: raw.category ?? null,
    supervisorName: raw.supervisorLabel ?? null,
  }));
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

  return (body.units ?? []).map((raw) => ({
    id: raw.uid,
    label: raw.label,
    abbreviation: raw.abbreviation ?? null,
    category: raw.category ?? null,
    active: raw.active !== false,
    activeFrom: toOptionalIsoDate(raw.activeFrom),
    activeUntil: toOptionalIsoDate(raw.activeUntil),
    parentId: raw.parentId ?? null,
  }));
}

export async function fetchSigner(uid: string, signal: AbortSignal): Promise<Signer> {
  const raw = await getOrNotFound<RawSigner>(
    `signers/${encodeURIComponent(uid)}.json`,
    signal,
    `No signer is registered under uid "${uid}". Signer uids come from the signerIds on a decision.`,
    { uid },
  );

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
    `No dictionary named "${name}".`,
    { dictionary: name },
  );

  return (body.items ?? []).map((item) => ({
    code: item.uid,
    label: item.label,
    parent: item.parent ?? null,
  }));
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
): Promise<T> {
  try {
    return await http.getJson<T>(path, { signal });
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
 * The issue-date window upstream actually applied, read back off the Lucene
 * query it echoes.
 *
 * Upstream caps the window at six months and truncates anything longer without
 * saying so — asking for all of 2025 returns January to June and reports a
 * total for that half only. The requested range and the searched range are
 * therefore different things, and this is the one that is true.
 */
export function effectiveIssueWindow(query: string): { from: string; to: string } | null {
  const match = /issueDate:\[DT\((\d{4}-\d{2}-\d{2})[^)]*\) TO DT\((\d{4}-\d{2}-\d{2})[^)]*\)\]/u.exec(
    query,
  );
  return match?.[1] && match[2] ? { from: match[1], to: match[2] } : null;
}
