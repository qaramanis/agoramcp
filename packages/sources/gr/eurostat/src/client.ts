import {
  cacheKey,
  createHttpClient,
  InvalidInputError,
  NotFoundError,
  readCapped,
  UpstreamError,
  withCache,
  type Cache,
  type QueryParams,
} from "@agoramcp/core";

/**
 * Eurostat's dissemination API. Two services under one host, no credential:
 * the statistics API, which answers JSON-stat 2.0, and the catalogue API,
 * whose table of contents is a tab-separated file. The SDMX 2.1 endpoints
 * beside them are not needed — the statistics API describes a dataset's
 * dimensions, with English labels, when asked for a period it does not hold.
 */
export const STATISTICS_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/";
export const CATALOGUE_URL = "https://ec.europa.eu/eurostat/api/dissemination/catalogue/";

const statistics = createHttpClient({ baseUrl: STATISTICS_URL, timeoutMs: 30_000, retries: 2 });
const catalogue = createHttpClient({ baseUrl: CATALOGUE_URL, timeoutMs: 45_000, retries: 1 });

/**
 * Upstream has no size guard of its own: an unfiltered national-accounts
 * cube streamed 18.5 MB over 32 s with a 200 and no length. The tools refuse
 * a selection too large before asking; this is the second line, counted as
 * the bytes arrive.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** The table of contents is 2 MB of text, and structure changes with a release. */
const CATALOGUE_TTL = 21_600;

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

interface RawError {
  error?: { status?: number; id?: number; label?: string }[];
}

/**
 * Every error comes back as `{ error: [{ status, id, label }] }`, the label
 * being the only useful part: `ERR_NOT_FOUND_4: NOSUCHDATASET … is not
 * available for dissemination`, `INVALID_QUERY_DIMENSION: … Dimension
 * "COUNTRY" is not defined`.
 */
function upstreamLabel(error: UpstreamError): string {
  const body = typeof error.details?.body === "string" ? error.details.body : "";
  try {
    return ((JSON.parse(body) as RawError).error?.[0]?.label ?? "").trim();
  } catch {
    return "";
  }
}

async function fetchDataset(code: string, query: QueryParams, signal: AbortSignal): Promise<RawDataset> {
  let response: Response;
  try {
    response = await statistics.request(`data/${encodeURIComponent(code)}`, {
      query: { format: "JSON", lang: "EN", ...query },
      signal,
    });
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) {
      throw new NotFoundError(`Eurostat has no dataset "${code}". search_datasets finds dataset codes by words.`, {
        details: { dataset: code },
      });
    }
    if (error instanceof UpstreamError && error.status === 400) {
      const label = upstreamLabel(error);
      throw new InvalidInputError(`Eurostat refused the query${label ? `: ${label}` : "."}`, { details: { dataset: code } });
    }
    throw error;
  }

  const bytes = await readCapped(response, MAX_BODY_BYTES);
  if (!bytes) {
    throw new UpstreamError(
      `That selection of ${code} is more than ${MAX_BODY_BYTES / 1_048_576} MB. Fix more dimensions, or ask for fewer periods.`,
      { status: 413, details: { dataset: code } },
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as RawDataset;
  } catch (cause) {
    throw new UpstreamError("Eurostat returned a body that is not valid JSON.", { cause, details: { dataset: code } });
  }
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

export interface CatalogueEntry {
  code: string;
  title: string;
  /** `table` is a curated, small view; `dataset` the full cube behind it. */
  type: "dataset" | "table";
  /** The folders it sits in, outermost first. */
  path: string[];
  lastUpdate: string | null;
  dataStart: string | null;
  dataEnd: string | null;
  observations: number | null;
}

/** `08.10.2026` → `2026-10-08`. Folder rows carry a single space instead. */
function catalogueDate(value: string | undefined): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec((value ?? "").trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function unquote(value: string | undefined): string {
  const text = value ?? "";
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replaceAll('""', '"') : text;
}

/**
 * The table of contents as a flat list. Its only structure is indentation:
 * four leading spaces in a title per folder level. A code appears once per
 * folder that lists it — 12,248 rows for about 7,560 codes — and is kept
 * once, under the first path that reached it.
 */
export function parseCatalogue(text: string): CatalogueEntry[] {
  const entries = new Map<string, CatalogueEntry>();
  const folders: string[] = [];

  for (const line of text.split(/\r?\n/u).slice(1)) {
    if (line.trim() === "") continue;
    const cells = line.split("\t").map(unquote);
    const [rawTitle = "", code = "", type = "", lastUpdate, , dataStart, dataEnd, values] = cells;
    const depth = Math.floor((rawTitle.length - rawTitle.trimStart().length) / 4);
    const title = rawTitle.trim();

    if (type === "folder") {
      folders.length = depth;
      folders[depth] = title;
      continue;
    }
    if ((type !== "dataset" && type !== "table") || code === "" || entries.has(code)) continue;

    const observations = Number(values);
    entries.set(code, {
      code,
      title,
      type,
      path: folders.slice(0, depth).filter((folder) => folder !== undefined),
      lastUpdate: catalogueDate(lastUpdate),
      dataStart: (dataStart ?? "").trim() || null,
      dataEnd: (dataEnd ?? "").trim() || null,
      observations: values !== undefined && values.trim() !== "" && Number.isFinite(observations) ? observations : null,
    });
  }

  return [...entries.values()];
}

export async function fetchCatalogue(cache: Cache, signal: AbortSignal): Promise<CatalogueEntry[]> {
  return withCache(cache, cacheKey("eurostat:catalogue", "en"), CATALOGUE_TTL, async () => {
    const text = await catalogue.getText("toc/txt", { query: { lang: "en" }, signal, headers: { accept: "text/plain" } });
    const entries = parseCatalogue(text);
    if (entries.length === 0) throw new UpstreamError("Eurostat's table of contents came back empty.");
    return entries;
  });
}

/* -------------------------------------------------------------------------- */
/* JSON-stat                                                                  */
/* -------------------------------------------------------------------------- */

interface RawCategory {
  index?: Record<string, number> | string[];
  label?: Record<string, string>;
}

interface RawDataset {
  label?: string;
  updated?: string;
  id?: string[];
  size?: number[];
  dimension?: Record<string, { label?: string; category?: RawCategory }>;
  value?: Record<string, number | null> | (number | null)[];
  status?: Record<string, string> | string[] | string;
  extension?: {
    description?: string;
    annotation?: { type?: string; title?: string; date?: string }[];
    status?: { label?: Record<string, string> };
  };
}

export interface Code {
  code: string;
  label: string;
}

export interface DimensionInfo {
  id: string;
  label: string;
  /** In the cube's own order, which is the order of its index. */
  codes: Code[];
}

export interface DatasetInfo {
  code: string;
  title: string;
  updated: string | null;
  /** Every dimension but time, which a structure query leaves empty. */
  dimensions: DimensionInfo[];
  observations: number | null;
  oldestPeriod: string | null;
  latestPeriod: string | null;
  doi: string | null;
  description: string | null;
  discontinued: boolean;
  replacedBy: string | null;
}

/** JSON-stat allows a category index as an array of codes or an object of code → position. */
function orderedCodes(category: RawCategory | undefined): string[] {
  const index = category?.index;
  if (Array.isArray(index)) return index;
  if (!index) return Object.keys(category?.label ?? {});
  return Object.entries(index)
    .sort((a, b) => a[1] - b[1])
    .map(([code]) => code);
}

function annotation(raw: RawDataset, type: string): { title?: string; date?: string } | undefined {
  return raw.extension?.annotation?.find((entry) => entry.type === type);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n+/gu, "\n")
    .trim();
}

const MAX_DESCRIPTION = 800;

export function describeDataset(code: string, raw: RawDataset): DatasetInfo {
  const ids = raw.id ?? [];
  const dimensions = ids
    .filter((id) => id !== "time")
    .map((id) => {
      const dimension = raw.dimension?.[id];
      const labels = dimension?.category?.label ?? {};
      return {
        id,
        label: dimension?.label ?? id,
        codes: orderedCodes(dimension?.category).map((value) => ({ code: value, label: labels[value] ?? value })),
      };
    });

  const description = raw.extension?.description ? stripHtml(raw.extension.description) : null;
  const discontinued = description !== null && /\bdiscontinued\b/iu.test(description);
  // "…is discontinued and replaced by dataset prc_hicp_minr": the code is the
  // first word after the phrase that has an underscore or a digit in it.
  const replacedBy = discontinued
    ? (/replaced by\W+(?:(?:the|new|dataset|table)\W+)*([a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z]+\d[a-z0-9]*)/iu.exec(description ?? "")?.[1]?.toLowerCase() ?? null)
    : null;
  const doi = /10\.2908\/[A-Za-z0-9_]+/u.exec(annotation(raw, "DISSEMINATION_DOI_XML")?.title ?? "")?.[0] ?? null;
  const count = Number(annotation(raw, "OBS_COUNT")?.title);

  return {
    code: code.toLowerCase(),
    title: raw.label ?? code,
    updated: raw.updated ?? null,
    dimensions,
    observations: Number.isFinite(count) ? count : null,
    oldestPeriod: annotation(raw, "OBS_PERIOD_OVERALL_OLDEST")?.title ?? null,
    latestPeriod: annotation(raw, "OBS_PERIOD_OVERALL_LATEST")?.title ?? null,
    doi,
    description: description === null ? null : description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description,
    discontinued,
    replacedBy,
  };
}

/**
 * A dataset's dimensions and every code in them, by asking for a period it
 * cannot hold: the answer is the cube's full structure with no values,
 * 4–45 KB and under a second even for a cube of nine million observations.
 */
export async function fetchStructure(code: string, cache: Cache, signal: AbortSignal): Promise<DatasetInfo> {
  const dataset = code.trim().toLowerCase();
  return withCache(cache, cacheKey("eurostat:structure", dataset), CATALOGUE_TTL, async () => {
    const raw = await fetchDataset(dataset, { sinceTimePeriod: "2999" }, signal);
    return describeDataset(dataset, raw);
  });
}

export interface Cell {
  /** Code per dimension, time included. */
  codes: Record<string, string>;
  value: number | null;
  /** Eurostat's flag, e.g. `p`, `e`, `b`, `|C`. */
  flag: string | null;
}

export interface Cube {
  ids: string[];
  /** Codes present per dimension in this answer, in cube order, with labels. */
  dimensions: Record<string, { label: string; codes: Code[] }>;
  cells: Cell[];
  /** Flag letter → meaning, for the flags this answer uses. */
  flags: Record<string, string>;
}

/**
 * JSON-stat 2.0 holds a cube as one flat, sparse map from a row-major index
 * to a value, the last dimension (time) varying fastest. A cell is turned
 * back into codes by peeling that index apart with the sizes, last
 * dimension first. Flags live in a parallel map, and a cell can have a flag
 * and no value — `|C`, confidential — so both maps are walked.
 */
export function decodeCube(raw: RawDataset): Cube {
  const ids = raw.id ?? [];
  const sizes = raw.size ?? [];
  const codesByDim = ids.map((id) => orderedCodes(raw.dimension?.[id]?.category));

  const values = new Map<number, number | null>();
  const flags = new Map<number, string>();
  if (Array.isArray(raw.value)) raw.value.forEach((value, index) => value !== null && values.set(index, value));
  else for (const [index, value] of Object.entries(raw.value ?? {})) values.set(Number(index), value);
  if (typeof raw.status === "string") {
    for (const index of values.keys()) flags.set(index, raw.status);
  } else if (Array.isArray(raw.status)) {
    raw.status.forEach((flag, index) => flag && flags.set(index, flag));
  } else {
    for (const [index, flag] of Object.entries(raw.status ?? {})) if (flag) flags.set(Number(index), flag);
  }

  const indexes = [...new Set([...values.keys(), ...flags.keys()])].sort((a, b) => a - b);
  const cells: Cell[] = indexes.map((flat) => {
    const codes: Record<string, string> = {};
    let rest = flat;
    for (let d = ids.length - 1; d >= 0; d -= 1) {
      const size = sizes[d] ?? 1;
      const position = rest % size;
      rest = Math.floor(rest / size);
      codes[ids[d] as string] = codesByDim[d]?.[position] ?? String(position);
    }
    return { codes, value: values.get(flat) ?? null, flag: flags.get(flat) ?? null };
  });

  const dimensions: Cube["dimensions"] = {};
  ids.forEach((id, d) => {
    const labels = raw.dimension?.[id]?.category?.label ?? {};
    dimensions[id] = {
      label: raw.dimension?.[id]?.label ?? id,
      codes: (codesByDim[d] ?? []).map((code) => ({ code, label: labels[code] ?? code })),
    };
  });

  const used = new Set(cells.map((cell) => cell.flag).filter((flag): flag is string => flag !== null));
  const legend = raw.extension?.status?.label ?? {};
  const flagLegend: Record<string, string> = {};
  for (const flag of used) flagLegend[flag] = legend[flag] ?? flag;

  return { ids, dimensions, cells, flags: flagLegend };
}

export interface DataQuery {
  dataset: string;
  /** Dimension id → codes, already checked against the structure. */
  filters: Record<string, string[]>;
  sinceTimePeriod?: string | undefined;
  untilTimePeriod?: string | undefined;
  lastTimePeriod?: number | undefined;
}

export async function fetchCube(query: DataQuery, cache: Cache, ttl: number, signal: AbortSignal): Promise<Cube> {
  return withCache(cache, cacheKey("eurostat:data", query), ttl, async () => {
    const raw = await fetchDataset(
      query.dataset,
      {
        ...query.filters,
        sinceTimePeriod: query.sinceTimePeriod,
        untilTimePeriod: query.untilTimePeriod,
        lastTimePeriod: query.lastTimePeriod,
      },
      signal,
    );
    return decodeCube(raw);
  });
}

/* -------------------------------------------------------------------------- */
/* Periods                                                                    */
/* -------------------------------------------------------------------------- */

const PERIOD = /^(\d{4})(?:-(?:(\d{2})(?:-(\d{2}))?|Q([1-4])|S([12])|W(\d{2})))?$/u;

/** A period as a fractional year, for counting how many periods a window spans. */
export function periodYears(period: string): number | undefined {
  const match = PERIOD.exec(period.trim().toUpperCase());
  if (!match) return undefined;
  const year = Number(match[1]);
  const [, , month, day, quarter, half, week] = match;
  if (week !== undefined) return year + (Number(week) - 1) / 52;
  if (quarter !== undefined) return year + (Number(quarter) - 1) / 4;
  if (half !== undefined) return year + (Number(half) - 1) / 2;
  if (month !== undefined) {
    const m = Number(month);
    if (m < 1 || m > 12) return undefined;
    return year + (m - 1) / 12 + (day === undefined ? 0 : (Number(day) - 1) / 365);
  }
  return year;
}

/** Periods a year at each frequency code Eurostat uses in `freq`. */
export const PERIODS_PER_YEAR: Record<string, number> = { A: 1, S: 2, Q: 4, M: 12, W: 52, D: 365, B: 260 };

/**
 * `lastTimePeriod=N` counts the last N periods of the whole dataset, not of
 * each series: Greece's September unemployment is not out when Germany's is,
 * so `geo=EL&lastTimePeriod=1` answers with nothing. Asking for a few more
 * periods than wanted and keeping each series' own latest N absorbs that.
 */
export const LATEST_SLACK: Record<string, number> = { A: 3, S: 2, Q: 4, M: 6, W: 8, D: 10, B: 10 };
