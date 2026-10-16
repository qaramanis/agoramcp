import {
  cacheKey,
  createHttpClient,
  InvalidInputError,
  NotFoundError,
  pageTexts,
  readCapped,
  UpstreamError,
  withCache,
  type Cache,
} from "@agoramcp/core";
import { getDocumentProxy } from "unpdf";

/**
 * Two upstreams, no credential.
 *
 * The search backend behind search.et.gr is undocumented: its address is in
 * the portal's JavaScript bundle, and it may change without notice. It is
 * the only index there is — api.et.gr serves PDFs by number and nothing else
 * — so it is what makes the gazette searchable at all.
 *
 * The PDFs come from the portal's blob store, by a path built from the
 * series, year and issue number. A law's PDF is its whole ΦΕΚ issue:
 * api.et.gr's law route returns the same bytes.
 */
export const SEARCH_URL = "https://searchetv99.azurewebsites.net/api/";
export const BLOB_URL = "https://ia37rg02wpsa01.blob.core.windows.net/fek/";
export const PAGE_URL = "https://search.et.gr/el/fek/?fekId=";

const search = createHttpClient({ baseUrl: SEARCH_URL, timeoutMs: 30_000, retries: 2 });
const blobs = createHttpClient({ baseUrl: BLOB_URL, timeoutMs: 60_000, retries: 1 });

/**
 * A full year of series Β is 6,238 rows and 2.5 MB; a text search with no
 * year reached 5 MB. The tools refuse the unbounded queries; this caps what
 * is left.
 */
const MAX_SEARCH_BYTES = 8 * 1024 * 1024;

/**
 * Bounded like Διαύγεια's: law 4600/2019 is one 228-page issue of 43.8 MB,
 * and a scanned one carries no text worth the memory.
 */
export const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Vocabularies                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The ΦΕΚ series, by the id the backend calls `IssueGroupID`. Aliases are
 * folded (no accents, dots or spaces, upper case) and include the Latin
 * look-alikes people type: `A` for Α, `B` for Β, `D` for Δ.
 */
export const SERIES: readonly { id: number; label: string; name: string; aliases: readonly string[] }[] = [
  { id: 1, label: "Α", name: "Πρώτο — νόμοι, προεδρικά διατάγματα, πράξεις νομοθετικού περιεχομένου", aliases: ["Α", "A"] },
  { id: 2, label: "Β", name: "Δεύτερο — υπουργικές και κανονιστικές αποφάσεις", aliases: ["Β", "B"] },
  { id: 3, label: "Γ", name: "Τρίτο — διορισμοί και υπηρεσιακές μεταβολές στο Δημόσιο", aliases: ["Γ", "G", "C"] },
  { id: 4, label: "Δ", name: "Τέταρτο — πολεοδομία, απαλλοτριώσεις, χωροταξία", aliases: ["Δ", "D"] },
  { id: 5, label: "Ν.Π.Δ.Δ.", name: "Νομικά πρόσωπα δημοσίου δικαίου (1984–2006)", aliases: ["ΝΠΔΔ", "NPDD"] },
  { id: 6, label: "Α.Π.Σ.", name: "Ανώτατο Ειδικό Δικαστήριο, πρακτικά (2000–2006)", aliases: ["ΑΠΣ", "APS"] },
  { id: 7, label: "ΠΑΡΑΡΤΗΜΑ", name: "Παράρτημα (2000–2006)", aliases: ["ΠΑΡΑΡΤΗΜΑ", "PARARTIMA", "PARARTHMA"] },
  { id: 8, label: "Δ.Ε.Β.Ι.", name: "Δελτίο Εμπορικής και Βιομηχανικής Ιδιοκτησίας (2000–2012)", aliases: ["ΔΕΒΙ", "DEBI"] },
  { id: 9, label: "Α.ΕΙ.Δ.", name: "Αγορανομικές και ειδικές διατάξεις", aliases: ["ΑΕΙΔ", "AEID"] },
  { id: 10, label: "Α.Σ.Ε.Π.", name: "Προκηρύξεις ΑΣΕΠ", aliases: ["ΑΣΕΠ", "ASEP"] },
  { id: 11, label: "ΠΡΑ.Δ.Ι.Τ.", name: "Πράξεις και δημοσιεύσεις ιδιωτικού τομέα (ΑΕ-ΕΠΕ έως το 2014)", aliases: ["ΠΡΑΔΙΤ", "ΑΕΕΠΕ", "PRADIT", "AEEPE"] },
  { id: 12, label: "Δ.Δ.Σ.", name: "Διακηρύξεις δημοσίων συμβάσεων", aliases: ["ΔΔΣ", "DDS"] },
  { id: 13, label: "Ο.Π.Κ.", name: "Οργανισμοί και πράξεις κοινωνικής ασφάλισης (2004–2014)", aliases: ["ΟΠΚ", "OPK"] },
  { id: 14, label: "Υ.Ο.Δ.Δ.", name: "Υπηρεσιακά όργανα, μετακλήσεις και διορισμοί Δημοσίου", aliases: ["ΥΟΔΔ", "YODD"] },
  { id: 15, label: "Α.Α.Π.", name: "Αποφάσεις αρχών προστασίας (2006–2019)", aliases: ["ΑΑΠ", "AAP"] },
];

function foldSeries(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[\s.\-_'΄]/gu, "").replace(/^ΦΕΚ/u, "");
}

export function resolveSeries(given: string): (typeof SERIES)[number] {
  const wanted = foldSeries(given);
  const found = SERIES.find((series) => String(series.id) === wanted || series.aliases.includes(wanted));
  if (!found) {
    throw new InvalidInputError(
      `"${given}" is not a ΦΕΚ series. The series are ${SERIES.map((series) => series.label).join(", ")}: Α for laws and decrees, Β for ministerial decisions, Δ for planning, Γ for appointments.`,
    );
  }
  return found;
}

export function seriesLabel(id: number | string): string {
  return SERIES.find((series) => series.id === Number(id))?.label ?? String(id);
}

/** The legislation catalogues of `searchlegislation`, by the names a caller uses. */
export const KINDS = {
  law: { id: "1", label: "Νόμος" },
  presidential_decree: { id: "2", label: "Προεδρικό Διάταγμα" },
  legislative_content_act: { id: "3", label: "Πράξη Νομοθετικού Περιεχομένου" },
  royal_decree: { id: "102", label: "Βασιλικό Διάταγμα" },
  legislative_decree: { id: "301", label: "Νομοθετικό Διάταγμα" },
  legislative_presidential_decree: { id: "501", label: "Νομοθετικό Προεδρικό Διάταγμα" },
  emergency_law: { id: "101", label: "Αναγκαστικός Νόμος" },
} as const;

export type Kind = keyof typeof KINDS;

export const KIND_NAMES = Object.keys(KINDS) as [Kind, ...Kind[]];

function kindOf(id: string | undefined): Kind | null {
  return (Object.entries(KINDS).find(([, kind]) => kind.id === id)?.[0] as Kind | undefined) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Search backend                                                             */
/* -------------------------------------------------------------------------- */

interface Envelope {
  status?: string;
  message?: string;
  /** The answer itself, as a JSON string inside the JSON: it is parsed twice. */
  data?: string;
}

/**
 * Every answer is `{ status, message, data }` with `data` a JSON string. Not
 * found is `data: "[]"` with a 200. A malformed body is a 400 with
 * `"Operation error"`; an unknown catalogue id a 500 with no body.
 */
async function call<T>(path: string, body: unknown, signal: AbortSignal): Promise<T[]> {
  let response: Response;
  try {
    response = await search.request(path, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      signal,
    });
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 400) {
      throw new InvalidInputError("The gazette's search refused the query as malformed.", { details: { path } });
    }
    throw error;
  }

  const bytes = await readCapped(response, MAX_SEARCH_BYTES);
  if (!bytes) {
    throw new UpstreamError(
      `That search returned more than ${MAX_SEARCH_BYTES / 1_048_576} MB. Narrow it by series, year or a shorter date range.`,
      { status: 413 },
    );
  }
  const text = new TextDecoder().decode(bytes);
  try {
    const envelope = JSON.parse(text) as Envelope;
    if (envelope.status !== "ok") {
      throw new UpstreamError(`The gazette's search answered "${envelope.message ?? envelope.status ?? "nothing"}".`);
    }
    const data = JSON.parse(envelope.data ?? "[]") as unknown;
    return Array.isArray(data) ? (data as T[]) : [];
  } catch (cause) {
    if (cause instanceof UpstreamError) throw cause;
    throw new UpstreamError("The gazette's search returned a body that is not valid JSON.", {
      cause,
      details: { preview: text.slice(0, 200) },
    });
  }
}

/**
 * Every date the backend writes is US order, `MM/DD/YYYY HH:mm:ss`:
 * "11/09/2022" is the ninth of November. Read any other way, a third of all
 * dates are wrong and the rest impossible.
 */
export function usDate(value: string | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/u.exec(value ?? "");
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

export function pdfUrl(seriesId: number, year: number, number: number): string {
  return `${BLOB_URL}${String(seriesId).padStart(2, "0")}/${year}/${year}${String(seriesId).padStart(2, "0")}${String(number).padStart(5, "0")}.pdf`;
}

export interface Issue {
  /** The search backend's id for the issue: what get_gazette_issue takes. */
  id: string;
  series: string;
  seriesId: number;
  number: number;
  year: number | null;
  /** `Α 210/2022`, as it is cited. */
  label: string;
  /** The date on the issue. */
  issueDate: string | null;
  /** The day it was released, which can trail the issue date. */
  releaseDate: string | null;
  pages: number | null;
  pdfUrl: string | null;
  pageUrl: string;
}

interface RawRow {
  search_ID?: string;
  search_DocumentNumber?: string;
  search_IssueGroupID?: string;
  search_IssueDate?: string;
  search_PublicationDate?: string;
  search_Pages?: string;
  search_PrimaryLabel?: string;
  search_LawID?: string;
  search_LawProtocolNumber?: string;
  search_Description?: string;
  search_Score?: string;
  search_MatchedText?: string;
  search_stemmedQuery?: string;
}

function toIssue(row: RawRow): Issue {
  const seriesId = Number(row.search_IssueGroupID);
  const number = Number(row.search_DocumentNumber);
  const issueDate = usDate(row.search_IssueDate);
  const year = issueDate ? Number(issueDate.slice(0, 4)) : null;
  return {
    id: row.search_ID ?? "",
    series: seriesLabel(seriesId),
    seriesId,
    number,
    year,
    label: row.search_PrimaryLabel ?? "",
    issueDate,
    releaseDate: usDate(row.search_PublicationDate),
    pages: row.search_Pages ? Number(row.search_Pages) : null,
    pdfUrl: year !== null && Number.isInteger(number) && number > 0 ? pdfUrl(seriesId, year, number) : null,
    pageUrl: `${PAGE_URL}${row.search_ID ?? ""}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Legislation                                                                */
/* -------------------------------------------------------------------------- */

export interface Legislation extends Issue {
  kind: Kind | null;
  /** The act's own number, `4990` — not the issue's. Null for acts that have none. */
  lawNumber: string | null;
  title: string | null;
}

export interface LegislationQuery {
  kind: Kind;
  number?: string | undefined;
  years: number[];
}

/**
 * The law index. Never without a year or a number: the decree catalogues
 * with neither streamed 46–51 MB and were still going at 60 s.
 */
export async function searchLegislation(
  query: LegislationQuery,
  cache: Cache,
  ttl: number,
  signal: AbortSignal,
): Promise<Legislation[]> {
  if (query.number === undefined && query.years.length === 0) {
    throw new InvalidInputError("Give a year, or the act's number: the whole catalogue is too large to list.");
  }
  return withCache(cache, cacheKey("et:legislation", query), ttl, async () => {
    const rows = await call<RawRow>(
      "searchlegislation",
      {
        legislationCatalogues: KINDS[query.kind].id,
        legislationNumber: query.number ?? "",
        selectYear: query.years.map(String),
      },
      signal,
    );
    return rows
      .filter((row) => row.search_ID)
      .map((row) => {
        const lawNumber = (row.search_LawProtocolNumber ?? "").trim();
        return {
          ...toIssue(row),
          kind: kindOf(row.search_LawID),
          // ΠΝΠ carry "Π.Ν.Π." or "-" where the number would be.
          lawNumber: /\d/u.test(lawNumber) ? lawNumber : null,
          title: (row.search_Description ?? "").trim() || null,
        };
      });
  });
}

/* -------------------------------------------------------------------------- */
/* Gazette issues                                                             */
/* -------------------------------------------------------------------------- */

export interface GazetteHit extends Issue {
  /** For a text search: the matching passage, lower case and without accents, as the index holds it. */
  snippet?: string;
  /** For a text search: upstream's rank, highest first. */
  rank?: number;
}

export interface GazetteQuery {
  years: number[];
  seriesIds: number[];
  number?: number | undefined;
  text?: string | undefined;
  /** "YYYY-MM-DD YYYY-MM-DD", on the date printed on the issue. */
  issued?: string | undefined;
  /** "YYYY-MM-DD YYYY-MM-DD", on the day it was released. */
  released?: string | undefined;
}

export async function searchGazette(
  query: GazetteQuery,
  cache: Cache,
  ttl: number,
  signal: AbortSignal,
): Promise<{ hits: GazetteHit[]; stemmedQuery: string | null }> {
  return withCache(cache, cacheKey("et:gazette", query), ttl, async () => {
    const rows = await call<RawRow>(
      "simplesearch",
      {
        selectYear: query.years.map(String),
        selectIssue: query.seriesIds.map(String),
        documentNumber: query.number === undefined ? "" : String(query.number),
        searchText: query.text ?? "",
        datePublished: query.issued ?? "",
        dateReleased: query.released ?? "",
      },
      signal,
    );

    // A text search slips one extra element into the array: the stemmed
    // query, `{ search_stemmedQuery: "πυρκαγι" }`.
    const stemmed = rows.find((row) => row.search_stemmedQuery !== undefined)?.search_stemmedQuery ?? null;
    const hits = rows
      .filter((row) => row.search_ID)
      .map((row) => {
        const hit: GazetteHit = toIssue(row);
        if (row.search_MatchedText) hit.snippet = decodeSnippet(row.search_MatchedText);
        if (query.text) hit.rank = Number(row.search_Score) || 0;
        return hit;
      });
    return { hits, stemmedQuery: stemmed };
  });
}

/** The matching passage arrives as base64 of UTF-8. */
export function decodeSnippet(base64: string): string {
  try {
    return Buffer.from(base64, "base64").toString("utf8").replace(/\s+/gu, " ").trim();
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* One issue                                                                  */
/* -------------------------------------------------------------------------- */

type Prefixed = Record<string, string | undefined>;

export interface Relation {
  id: string;
  label: string;
  relation: string;
  relationEl: string;
}

export interface IssueDetail {
  id: string;
  series: string;
  seriesId: number;
  number: number;
  year: number | null;
  label: string;
  issueDate: string | null;
  releaseDate: string | null;
  reReleaseDate: string | null;
  pages: number | null;
  /** The portal's classification: Νόμοι, Αποφάσεις - Ανακοινώσεις… */
  topic: string | null;
  /** Who published it. */
  publishers: string[];
  /** Bodies the text refers to. */
  mentions: string[];
  tags: string[];
  /** Later acts that act on this one: amendments, repeals, extensions. */
  actedOnBy: Relation[];
  /** Earlier acts this one acts on. */
  actsOn: Relation[];
  pdfUrl: string | null;
  pageUrl: string;
}

function relations(rows: Prefixed[]): Relation[] {
  return rows
    .filter((row) => row.timeline_OtherDocumentID)
    .map((row) => ({
      id: row.timeline_OtherDocumentID ?? "",
      label: row.timeline_PrimaryLabel ?? "",
      relation: row.timeline_EnglishLabel ?? "",
      relationEl: row.timeline_GreekLabel ?? "",
    }));
}

/**
 * One issue, from four calls made side by side: its record, the bodies it
 * names, its tags, and its timeline both ways. `timeline/{id}/0` lists the
 * later acts that act on this one; `/1` the earlier ones it acts on.
 */
export async function fetchIssue(id: string, cache: Cache, ttl: number, signal: AbortSignal): Promise<IssueDetail> {
  return withCache(cache, cacheKey("et:issue", id), ttl, async () => {
    const path = encodeURIComponent(id);
    const [entity, named, tags, later, earlier] = await Promise.all([
      call<Prefixed>(`documententitybyid/${path}`, undefined, signal),
      call<Prefixed>(`namedentity/${path}`, undefined, signal),
      call<Prefixed>(`tagsbydocumententity/${path}`, undefined, signal),
      call<Prefixed>(`timeline/${path}/0`, undefined, signal),
      call<Prefixed>(`timeline/${path}/1`, undefined, signal),
    ]);

    const info = entity.find((row) => row.documententitybyid_PrimaryLabel !== undefined);
    if (!info) throw new NotFoundError(`No ΦΕΚ issue has id "${id}". search_gazette and search_legislation return ids.`);

    const seriesId = Number(info.documententitybyid_IssueGroupID);
    const number = Number(info.documententitybyid_DocumentNumber);
    const issueDate = usDate(info.documententitybyid_IssueDate);
    const year = issueDate ? Number(issueDate.slice(0, 4)) : null;
    const names = (relation: string) =>
      named
        .filter((row) => row.namedentity_RelationshipType === relation && row.namedentity_Name)
        .map((row) => (row.namedentity_Name ?? "").trim());

    return {
      id,
      series: seriesLabel(seriesId),
      seriesId,
      number,
      year,
      label: info.documententitybyid_PrimaryLabel ?? "",
      issueDate,
      releaseDate: usDate(info.documententitybyid_PublicationDate),
      reReleaseDate: usDate(info.documententitybyid_ReReleaseDate),
      pages: info.documententitybyid_Pages ? Number(info.documententitybyid_Pages) : null,
      topic: entity.find((row) => row.documententitybyid_topics_Name)?.documententitybyid_topics_Name ?? null,
      publishers: [...new Set(names("Publish"))],
      mentions: [...new Set(names("GenericReference"))],
      tags: [...new Set(tags.map((row) => (row.tagsbydocumententity_Value ?? "").trim()).filter(Boolean))],
      actedOnBy: relations(later),
      actsOn: relations(earlier),
      pdfUrl: year !== null && number > 0 ? pdfUrl(seriesId, year, number) : null,
      pageUrl: `${PAGE_URL}${id}`,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* The PDF                                                                    */
/* -------------------------------------------------------------------------- */

function tooLarge(url: string, bytes?: number): UpstreamError {
  const size = bytes === undefined ? `over ${MAX_DOCUMENT_BYTES / 1_048_576} MB` : `${Math.round(bytes / 1_048_576)} MB`;
  return new UpstreamError(`This issue's PDF is ${size}, too large to read here. It can be downloaded from ${url}.`, {
    status: 413,
    details: { url, ...(bytes === undefined ? {} : { bytes }) },
  });
}

/**
 * The issue's PDF, sized first: the blob store answers HEAD with a length,
 * so a 43 MB issue is refused before a byte of it moves. The store sends
 * `application/octet-stream`, so the type is not checked; a missing blob is
 * a 404 with an XML body.
 */
export async function fetchPdf(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const path = url.slice(BLOB_URL.length);
  try {
    const head = await blobs.request(path, { method: "HEAD", signal, headers: { accept: "*/*" } });
    const declared = Number(head.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) throw tooLarge(url, declared);

    const response = await blobs.request(path, { signal, headers: { accept: "*/*" } });
    const bytes = await readCapped(response, MAX_DOCUMENT_BYTES);
    if (!bytes) throw tooLarge(url);
    return bytes;
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) {
      throw new NotFoundError(`The gazette has no PDF at ${url}. The issue may not exist, or not be digitised.`, { details: { url } });
    }
    throw error;
  }
}

export interface IssueText {
  pageCount: number;
  pages: string[];
}

/**
 * Runs of spaces to one, stray spaces off line ends, blank runs to one blank
 * line — and ∆, U+2206 INCREMENT, back to Δ: the 2022 issues set ΕΦΗΜΕΡΙ∆Α
 * with the mathematical sign, which no search for Δ would find.
 */
export function tidyText(text: string): string {
  return text
    .replaceAll("∆", "Δ")
    .replace(/[ \t ]+/gu, " ")
    .replace(/ ?\n ?/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export async function extractText(bytes: Uint8Array, signal: AbortSignal): Promise<IssueText> {
  // Quiet: pdf.js reports every oddity in a government PDF to the console.
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const pages = await pageTexts(pdf, signal);
    return { pageCount: pages.length, pages: pages.map(tidyText) };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
