import {
  cacheKey,
  createHttpClient,
  InvalidInputError,
  NotFoundError,
  readCapped,
  UpstreamError,
  withCache,
  type Cache,
} from "@agoramcp/core";
import { readWorkbook, type Cell, type Workbook } from "./sheet.ts";

/**
 * ΑΔΜΗΕ's file download API: a vocabulary of file types and, per type, the
 * files whose coverage overlaps a window. The files themselves are .xls and
 * .xlsx under `sites/default/files/`, read here by `sheet.ts`.
 */
export const BASE_URL = "https://www.admie.gr/";
const FILES_PREFIX = `${BASE_URL}sites/default/files/`;

const api = createHttpClient({ baseUrl: BASE_URL, timeoutMs: 30_000, retries: 2 });

/** The largest file seen is a 1.1 MB weekly offers workbook. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* File types                                                                 */
/* -------------------------------------------------------------------------- */

interface RawTypeDetails {
  process?: string;
  data_type?: string;
  period_covered?: string;
  publication_frequency?: string;
  time_gate?: string;
}

interface RawType {
  filetype?: string;
  GR?: RawTypeDetails[];
  EN?: RawTypeDetails[];
}

export interface FileType {
  code: string;
  process: string | null;
  dataType: string | null;
  period: string | null;
  frequency: string | null;
  timeGate: string | null;
  processEl: string | null;
  dataTypeEl: string | null;
}

function decodeHtml(text: string | undefined): string | null {
  const value = (text ?? "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
  return value === "" ? null : value;
}

/** The 74 file types, in both languages. Their `description` field is always empty. */
export async function fetchFileTypes(cache: Cache, signal: AbortSignal): Promise<FileType[]> {
  return withCache(cache, cacheKey("admie:filetypes", "all"), 86_400, async () => {
    const raw = await api.getJson<RawType[]>("getFiletypeInfo", { signal });
    const types = (Array.isArray(raw) ? raw : [])
      .filter((entry): entry is RawType & { filetype: string } => typeof entry.filetype === "string" && entry.filetype !== "")
      .map((entry) => {
        const en = entry.EN?.[0] ?? {};
        const el = entry.GR?.[0] ?? {};
        return {
          code: entry.filetype,
          process: decodeHtml(en.process),
          dataType: decodeHtml(en.data_type),
          period: decodeHtml(en.period_covered),
          frequency: decodeHtml(en.publication_frequency),
          timeGate: decodeHtml(en.time_gate),
          processEl: decodeHtml(el.process),
          dataTypeEl: decodeHtml(el.data_type),
        };
      });
    if (types.length === 0) throw new UpstreamError("ΑΔΜΗΕ listed no file types.");
    return types;
  });
}

/**
 * A file type by its code, matched without regard to case. Checked here
 * because upstream answers an unknown code — a typo — with an empty list,
 * which reads as "nothing was published".
 */
export async function resolveFileType(given: string, cache: Cache, signal: AbortSignal): Promise<FileType> {
  const types = await fetchFileTypes(cache, signal);
  const wanted = given.trim().toLowerCase();
  const found = types.find((type) => type.code.toLowerCase() === wanted);
  if (found) return found;
  const close = types.filter((type) => type.code.toLowerCase().includes(wanted.slice(0, 6))).slice(0, 5);
  throw new InvalidInputError(
    `"${given}" is not one of ΑΔΜΗΕ's file types.${close.length > 0 ? ` Close: ${close.map((type) => type.code).join(", ")}.` : ""} list_file_types lists all ${types.length}.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Files                                                                      */
/* -------------------------------------------------------------------------- */

interface RawFile {
  file_path?: string;
  file_description?: string;
  file_coverageperiod?: string;
  file_fromdate?: string;
  file_todate?: string;
  file_published?: string;
}

export interface AdmieFile {
  url: string;
  fileName: string;
  /** The `_NN` upload counter; a second upload of the same day is a correction. */
  version: number | null;
  coverageFrom: string | null;
  coverageTo: string | null;
  /** Greek local time, as upstream writes it, with no zone. */
  publishedAt: string | null;
  description: string | null;
  format: string;
}

/** `14.10.2026` → `2026-10-14`; `15.10.2026 06:05` → `2026-10-15T06:05`. */
export function dottedDate(value: string | undefined): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}:\d{2}))?/u.exec((value ?? "").trim());
  if (!match) return null;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return match[4] ? `${date}T${match[4]}` : date;
}

export function toFile(raw: RawFile): AdmieFile | null {
  const url = (raw.file_path ?? "").trim();
  if (!url.startsWith(FILES_PREFIX)) return null;
  const fileName = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
  const version = /_(\d{1,3})\.[A-Za-z]+$/u.exec(fileName)?.[1];
  return {
    url,
    fileName,
    version: version === undefined ? null : Number(version),
    coverageFrom: dottedDate(raw.file_fromdate),
    coverageTo: dottedDate(raw.file_todate),
    publishedAt: dottedDate(raw.file_published),
    description: decodeHtml(raw.file_description),
    format: (/\.([A-Za-z]+)$/u.exec(fileName)?.[1] ?? "").toLowerCase(),
  };
}

/**
 * Every file of one type whose coverage overlaps a window. All three
 * parameters are always sent: without a type upstream returns every type,
 * and without dates the type's whole history — 4.4 MB over 20 s.
 */
export async function listFiles(
  code: string,
  from: string,
  to: string,
  cache: Cache,
  ttl: number,
  signal: AbortSignal,
): Promise<AdmieFile[]> {
  return withCache(cache, cacheKey("admie:files", { code, from, to }), ttl, async () => {
    const raw = await api.getJson<RawFile[]>("getOperationMarketFilewRange", {
      query: { dateStart: from, dateEnd: to, FileCategory: code },
      signal,
      timeoutMs: 45_000,
    });
    return (Array.isArray(raw) ? raw : [])
      .map(toFile)
      .filter((file): file is AdmieFile => file !== null)
      .sort((a, b) => (b.coverageFrom ?? "").localeCompare(a.coverageFrom ?? "") || (b.version ?? 0) - (a.version ?? 0));
  });
}

/** For each coverage period, only its highest version. */
export function latestVersions(files: readonly AdmieFile[]): AdmieFile[] {
  const best = new Map<string, AdmieFile>();
  for (const file of files) {
    const key = `${file.coverageFrom}|${file.coverageTo}`;
    const held = best.get(key);
    if (
      !held ||
      (file.version ?? 0) > (held.version ?? 0) ||
      ((file.version ?? 0) === (held.version ?? 0) && (file.publishedAt ?? "") > (held.publishedAt ?? ""))
    ) {
      best.set(key, file);
    }
  }
  return [...best.values()].sort((a, b) => (b.coverageFrom ?? "").localeCompare(a.coverageFrom ?? ""));
}

/** Only ΑΔΜΗΕ's own files, and only workbooks: this is not a general downloader. */
export function checkFileUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidInputError(`"${url}" is not a URL. list_files returns the url of each file.`);
  }
  if (!parsed.href.startsWith(FILES_PREFIX)) {
    throw new InvalidInputError(`Only ΑΔΜΗΕ's own files can be read: the url must start with ${FILES_PREFIX}. list_files returns them.`);
  }
  if (!/\.xlsx?$/iu.test(parsed.pathname)) {
    throw new InvalidInputError("Only .xls and .xlsx files can be read here. PDF maintenance plans and the 2010 ZIP are links to open, not data to read.");
  }
  return parsed.href;
}

/** A file, downloaded and laid out as sheets. A file at a given URL never changes. */
export async function fetchWorkbook(url: string, cache: Cache, signal: AbortSignal): Promise<Workbook> {
  const href = checkFileUrl(url);
  return withCache(cache, cacheKey("admie:workbook", href), 86_400, async () => {
    let response: Response;
    try {
      response = await api.request(href.slice(BASE_URL.length), { signal, headers: { accept: "*/*" }, timeoutMs: 45_000 });
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) {
        throw new NotFoundError(`ΑΔΜΗΕ has no file at ${href}.`);
      }
      throw error;
    }
    const bytes = await readCapped(response, MAX_FILE_BYTES);
    if (!bytes) throw new UpstreamError(`The file at ${href} is over ${MAX_FILE_BYTES / 1_048_576} MB.`, { status: 413 });
    return readWorkbook(bytes);
  });
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                   */
/* -------------------------------------------------------------------------- */

const athensOffset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", timeZoneName: "shortOffset" });

/** Europe/Athens's UTC offset in hours at a moment: 2 in winter, 3 in summer. */
function offsetAt(ms: number): number {
  const name = athensOffset.formatToParts(new Date(ms)).find((part) => part.type === "timeZoneName")?.value ?? "GMT+2";
  return Number(/GMT([+-]\d+)/u.exec(name)?.[1] ?? 2);
}

/**
 * How many hours a Greek calendar day has: 23 on the last Sunday of March,
 * 25 on the last Sunday of October, 24 otherwise. The files cannot be
 * trusted to say — recent ones always carry a 25th column, filled with 0 on
 * an ordinary day and with a stray 2.0 on one spring day.
 */
export function hoursInDay(date: string): number {
  const start = Date.parse(`${date}T00:00:00Z`);
  // Offsets at local midnight at either end: noon UTC the day before is
  // safely before any change, and the change happens at 03:00–04:00 local.
  return 24 + offsetAt(start - 12 * 3_600_000) - offsetAt(start + 24 * 3_600_000 - 1);
}

/** Today's date in Athens, YYYY-MM-DD. */
export function athensToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* The system realisation file                                                */
/* -------------------------------------------------------------------------- */

/** Upper case, no accents, no spaces or dots: "ΣΥΝΟΛΟ Φ. ΑΕΡΙΟΥ" and "ΣΥΝΟΛΟ Φ.ΑΕΡΙΟΥ" compare equal. */
function foldLabel(value: Cell | undefined): string {
  return typeof value === "string" ? value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[\s.]/gu, "") : "";
}

/**
 * The rows the daily realisation is summed in, by every label they have
 * carried. Labels were Greek until 2022 and English after; renewables were
 * wind alone (ΣΥΝΟΛΟ ΑΙΟΛΙΚΩΝ) until the section widened.
 */
const REALISATION_ROWS = {
  totalLoad: ["ΣΥΝΟΛΙΚΟ ΦΟΡΤΙΟ"],
  netLoad: ["NET LOAD", "ΚΑΘΑΡΟ ΦΟΡΤΙΟ"],
  atticaLoad: ["ΦΟΡΤΙΟ ΑΤΤΙΚΗΣ"],
  pumping: ["TOTAL PUMPING", "ΑΝΤΛΗΣΗ"],
  imports: ["TOTAL IMPORTS", "ΣΥΝΟΛΟ ΕΙΣΑΓΩΓΩΝ"],
  exports: ["TOTAL EXPORTS", "ΣΥΝΟΛΟ ΕΞΑΓΩΓΩΝ"],
  netExports: ["EXPORTS-IMPORTS", "ΚΑΘΑΡΟ ΔΙΑΣΥΝΔΕΣΕΩΝ"],
  lignite: ["TOTAL LIGNITE", "ΣΥΝΟΛΟ ΛΙΓΝΙΤΙΚΩΝ"],
  oil: ["TOTAL OIL", "ΣΥΝΟΛΟ ΠΕΤΡΕΛΑΙΚΩΝ"],
  gas: ["TOTAL GAS", "ΣΥΝΟΛΟ Φ. ΑΕΡΙΟΥ"],
  hydro: ["TOTAL HYDRO", "ΣΥΝΟΛΟ ΥΔΡΟΗΛΕΚΤΡΙΚΩΝ"],
  renewables: ["TOTAL RES", "ΣΥΝΟΛΟ ΑΠΕ", "ΣΥΝΟΛΟ ΑΝΑΝΕΩΣΙΜΩΝ", "ΣΥΝΟΛΟ ΑΙΟΛΙΚΩΝ"],
  storage: ["TOTAL BESS"],
} as const;

export type RealisationKey = keyof typeof REALISATION_ROWS;

export interface RealisationRow {
  /** The day's total in MWh, as the file sums it. */
  total: number | null;
  /** MWh in each hour of the day, as many as the day has. */
  hourly: (number | null)[];
  /** The label the file used, which says what was counted. */
  label: string;
}

export interface Realisation {
  hours: number;
  rows: Partial<Record<RealisationKey, RealisationRow>>;
}

/**
 * The totals of a SystemRealizationSCADA file. Its sheet is found by name
 * (in 2022 it is second, after Oracle's XDO_METADATA); labels sit in column
 * B, hours start in column C, and the day's sum is the column headed SUM.
 */
export function parseRealisation(workbook: Workbook, date: string): Realisation {
  const sheet =
    workbook.sheets.find((candidate) => candidate.name === "System_Production") ??
    workbook.sheets.find((candidate) => candidate.name !== "XDO_METADATA");
  if (!sheet) throw new UpstreamError("The system realisation file has no production sheet.");

  const header = sheet.rows.find((row) => row[2] === "01" || row[2] === 1 || row[2] === "1");
  if (!header) throw new UpstreamError("The system realisation file has no hour header, so its columns cannot be read.");
  const hourColumns: number[] = [];
  let sumColumn = -1;
  header.forEach((cell, index) => {
    if (index < 2) return;
    if (typeof cell === "string" && /^(SUM|ΣΥΝΟΛΟ)$/iu.test(cell.trim())) sumColumn = index;
    else if (/^\d{1,2}$/u.test(String(cell ?? "").trim()) && sumColumn < 0) hourColumns.push(index);
  });

  const hours = hoursInDay(date);
  const wanted = new Map<string, RealisationKey>();
  for (const [key, labels] of Object.entries(REALISATION_ROWS)) {
    for (const label of labels) wanted.set(foldLabel(label), key as RealisationKey);
  }

  const rows: Realisation["rows"] = {};
  for (const row of sheet.rows) {
    const key = wanted.get(foldLabel(row[1]));
    if (!key || rows[key]) continue;
    const number = (cell: Cell | undefined) => (typeof cell === "number" ? cell : null);
    rows[key] = {
      total: sumColumn >= 0 ? number(row[sumColumn]) : null,
      hourly: hourColumns.slice(0, hours).map((column) => number(row[column])),
      label: String(row[1]).trim(),
    };
  }

  if (!rows.netLoad && !rows.totalLoad) {
    throw new UpstreamError("The system realisation file has none of the load rows this reader knows; its layout has changed.");
  }
  return { hours, rows };
}

/* -------------------------------------------------------------------------- */
/* The day-ahead forecasts                                                    */
/* -------------------------------------------------------------------------- */

export interface Forecast {
  /** MW in each quarter-hour of the dispatch day, the first being 00:00–00:15. */
  values: (number | null)[];
}

/**
 * An ISP day-ahead forecast: a header row numbering the quarter-hours 1–96
 * as text, and one row of values. The values are read by the number above
 * them, because the files have a blank column in the middle of the run.
 */
export function parseForecast(workbook: Workbook): Forecast {
  const sheet = workbook.sheets[0];
  const header = sheet?.rows.find((row) => row.some((cell) => cell === "1" || cell === 1));
  const values = sheet?.rows.find((row) => row !== header && row.filter((cell) => typeof cell === "number").length >= 20);
  if (!header || !values) throw new UpstreamError("The forecast file has no quarter-hour header and values; its layout has changed.");

  const byQuarter = new Map<number, number | null>();
  header.forEach((cell, index) => {
    const quarter = Number(cell);
    if (cell !== null && cell !== "" && Number.isInteger(quarter) && quarter >= 1 && quarter <= 100) {
      const value = values[index];
      byQuarter.set(quarter, typeof value === "number" ? value : null);
    }
  });
  const count = Math.max(0, ...byQuarter.keys());
  return { values: Array.from({ length: count }, (_, i) => byQuarter.get(i + 1) ?? null) };
}
