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
 * The ECB Data Portal's SDMX 2.1 REST API. One upstream, no credential, and
 * the only live host: `sdw-wsrest.ecb.europa.eu`, which most tutorials still
 * name, no longer answers.
 *
 * Two dialects behind one base URL. Data comes as SDMX-JSON; structure — the
 * list of flows, the dimensions of one — only as SDMX-ML, because the server
 * answers a JSON `Accept` on a structure path with 406 and ignores `format=`.
 */
export const API_URL = "https://data-api.ecb.europa.eu/service/";

const api = createHttpClient({
  baseUrl: API_URL,
  // A whole flow's series list for one country takes up to 3 s; a big
  // selection with observations, more.
  timeoutMs: 30_000,
  retries: 2,
});

/**
 * No answer the tools need comes near this: the Greek series list of the
 * largest flow, BSI, is 1.6 MB, and the dollar's whole daily history 1.1 MB.
 * Upstream never compresses and never sends a length, so the cap is counted
 * as the bytes arrive.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Structure changes a few times a year; a day is the most a caller waits to see it. */
const STRUCTURE_TTL = 86_400;

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The body as text, or `""` for upstream's empty 200 — which is how it says a
 * real series has no observation in the window asked for (a Sunday of daily
 * rates, a month not yet published). Its errors are mapped here, because two
 * of them read as something they are not:
 *
 * - A malformed query — a key with the wrong number of parts, a period it
 *   cannot read, a `startPeriod` after today — is answered 400 with an HTML
 *   page saying "your access has been blocked due to security concerns". It
 *   is not a block; the next valid call answers. The tools validate first so
 *   this is rare, and a caller who meets it is told it was the query.
 * - No matching series is a 404 problem+json, whose `detail` is worth keeping.
 */
async function fetchText(path: string, query: QueryParams, accept: string, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await api.request(path, { query, signal, headers: { accept } });
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) {
      throw new NotFoundError(notFoundMessage(error), { details: { path } });
    }
    if (error instanceof UpstreamError && error.status === 400) {
      throw new InvalidInputError(
        "The ECB refused this query as malformed. Check that the key has one part per dimension (find_series lists them) and that each period is a date, a month (2026-09), a quarter (2026-Q2) or a year, and not in the future.",
        { details: { path, query } },
      );
    }
    throw error;
  }

  const bytes = await readCapped(response, MAX_BODY_BYTES);
  if (!bytes) {
    throw new UpstreamError(
      `That selection is more than ${MAX_BODY_BYTES / 1_048_576} MB. Fix more parts of the key, or ask for fewer observations.`,
      { status: 413, details: { path } },
    );
  }
  return new TextDecoder().decode(bytes);
}

function notFoundMessage(error: UpstreamError): string {
  const body = typeof error.details?.body === "string" ? error.details.body : "";
  let detail = "";
  try {
    detail = String((JSON.parse(body) as { detail?: unknown }).detail ?? "");
  } catch {
    // Not every 404 is problem+json; the generic message below still holds.
  }
  if (/no results found/iu.test(detail)) {
    return "The ECB has no dataflow by that id. search_dataflows lists them.";
  }
  return "No series matches that key. find_series lists the series a flow holds and their keys; a code in the wrong position or the wrong case matches nothing.";
}

/* -------------------------------------------------------------------------- */
/* Periods                                                                    */
/* -------------------------------------------------------------------------- */

const PERIOD = /^(\d{4})(?:-(?:(\d{2})(?:-(\d{2}))?|Q([1-4])|S([12])|W(\d{2})))?$/u;

/** First and last day of an SDMX period, both as UTC midnights. */
export function periodBounds(period: string): { start: Date; end: Date } | undefined {
  const match = PERIOD.exec(period);
  if (!match) return undefined;
  const year = Number(match[1]);
  const [, , month, day, quarter, half, week] = match;

  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

  if (week !== undefined) {
    const n = Number(week);
    if (n < 1 || n > 53) return undefined;
    // ISO week 1 is the week holding 4 January; weeks start on Monday.
    const jan4 = utc(year, 0, 4);
    const monday = utc(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7) + (n - 1) * 7);
    return { start: monday, end: utc(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6) };
  }
  if (quarter !== undefined) {
    const q = Number(quarter);
    return { start: utc(year, (q - 1) * 3, 1), end: utc(year, q * 3, 0) };
  }
  if (half !== undefined) {
    const h = Number(half);
    return { start: utc(year, (h - 1) * 6, 1), end: utc(year, h * 6, 0) };
  }
  if (month !== undefined) {
    const m = Number(month);
    if (m < 1 || m > 12) return undefined;
    if (day !== undefined) {
      const date = utc(year, m - 1, Number(day));
      if (date.getUTCMonth() !== m - 1) return undefined;
      return { start: date, end: date };
    }
    return { start: utc(year, m - 1, 1), end: utc(year, m, 0) };
  }
  return { start: utc(year, 0, 1), end: utc(year, 11, 31) };
}

function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Checked here because upstream answers a bad period with its "access
 * blocked" page. A start after today is refused there too — even though an
 * end in the future is fine — so the comparison is against today's date in
 * UTC, which is never later than the server's own (CET) date.
 */
export function checkPeriods(
  startPeriod: string | undefined,
  endPeriod: string | undefined,
  now: Date = new Date(),
): { startPeriod: string | undefined; endPeriod: string | undefined } {
  const read = (value: string | undefined, field: string) => {
    if (value === undefined) return undefined;
    const period = value.trim().toUpperCase();
    const bounds = periodBounds(period);
    if (!bounds) {
      throw new InvalidInputError(
        `${field} "${value}" is not a period the ECB reads. Use a year (2025), a half (2025-S1), a quarter (2025-Q2), a month (2025-09), an ISO week (2025-W41) or a day (2025-10-14).`,
      );
    }
    return { period, bounds };
  };

  const start = read(startPeriod, "startPeriod");
  const end = read(endPeriod, "endPeriod");

  if (start && start.bounds.start > todayUtc(now)) {
    throw new InvalidInputError(
      `startPeriod ${start.period} begins after today, and the ECB refuses that. There are no observations from the future; an endPeriod past today is fine.`,
    );
  }
  if (start && end && start.bounds.start > end.bounds.end) {
    throw new InvalidInputError(`startPeriod ${start.period} is after endPeriod ${end.period}.`);
  }

  return { startPeriod: start?.period, endPeriod: end?.period };
}

/* -------------------------------------------------------------------------- */
/* Keys and flows                                                             */
/* -------------------------------------------------------------------------- */

const FLOW = /^[A-Z0-9_]{1,40}$/u;
const KEY = /^[A-Z0-9_+\-]*(?:\.[A-Z0-9_+\-]*)*$/u;

/**
 * A flow id, uppercased. Every code the ECB uses is uppercase, digits or
 * underscores (`_Z`, `4D0`, `XDC_R_B1GQ`), and the API matches them exactly,
 * so `mir` becomes `MIR` rather than a 404.
 */
export function normalizeFlow(flow: string): string {
  const id = flow.trim().toUpperCase();
  if (!FLOW.test(id)) {
    throw new InvalidInputError(`"${flow}" is not a dataflow id. Ids look like EXR, MIR or HICP; search_dataflows lists them.`);
  }
  return id;
}

/**
 * A series key in the ECB's own syntax: one part per dimension, separated by
 * dots, a part left empty to mean any code, and codes joined with `+` to mean
 * either. `D.USD+GBP.EUR.SP00.A` is two series.
 */
export function normalizeKey(key: string, dimensions: readonly Dimension[]): string {
  const normalized = key.trim().toUpperCase();
  if (!KEY.test(normalized)) {
    throw new InvalidInputError(
      `"${key}" is not a series key. A key is codes separated by dots, one per dimension, such as D.USD.EUR.SP00.A; leave a part empty for any code, and join codes with + for several.`,
    );
  }
  const parts = normalized.split(".");
  if (parts.length !== dimensions.length) {
    throw new InvalidInputError(
      `This flow's keys have ${dimensions.length} parts, ${dimensions.map((d) => d.id).join(".")}; "${key}" has ${parts.length}. find_series lists the series and their keys.`,
      { details: { dimensions: dimensions.map((d) => d.id) } },
    );
  }
  if (parts.every((part) => part === "")) {
    throw new InvalidInputError(
      "A key with every part empty asks for the whole flow, which runs to hundreds of thousands of series. Fix at least the country and the frequency; find_series helps.",
    );
  }
  return normalized;
}

/* -------------------------------------------------------------------------- */
/* Structure (SDMX-ML)                                                        */
/* -------------------------------------------------------------------------- */

export interface Dataflow {
  id: string;
  agency: string;
  name: string;
  /** The data structure definition it is built on, e.g. ECB_MIR1. */
  structure: string | null;
}

export interface Dimension {
  id: string;
  /** 1-based place in the key. */
  position: number;
  /** The codelist its codes come from, e.g. CL_AREA. */
  codelist: string | null;
}

export interface FlowStructure extends Dataflow {
  dimensions: Dimension[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag);
  return match?.[1] === undefined ? null : decodeXml(match[1]);
}

function englishName(body: string): string | null {
  const match = /<com:Name xml:lang="en">([\s\S]*?)<\/com:Name>/u.exec(body);
  return match?.[1] === undefined ? null : decodeXml(match[1]).trim();
}

/**
 * Every `<str:Dataflow>` in an SDMX-ML structure message. Read with patterns
 * rather than a parser: the messages are machine-written, flat and stable,
 * and nothing here needs more than an element's attributes and its English
 * name — the same call `gr/noa` makes for QuakeML.
 */
export function parseDataflows(xml: string): Dataflow[] {
  const flows: Dataflow[] = [];
  for (const match of xml.matchAll(/<str:Dataflow\b([^>]*)>([\s\S]*?)<\/str:Dataflow>/gu)) {
    const [, tag = "", body = ""] = match;
    const id = attribute(tag, "id");
    const agency = attribute(tag, "agencyID");
    if (!id || !agency) continue;
    const structure = /<Ref\b[^>]*\sid="([^"]+)"[^>]*class="DataStructure"/u.exec(body)?.[1] ?? null;
    flows.push({ id, agency, name: englishName(body) ?? id, structure });
  }
  return flows;
}

/** The dimensions of a data structure, in key order; the time dimension is not one. */
export function parseDimensions(xml: string): Dimension[] {
  const dimensions: Dimension[] = [];
  for (const match of xml.matchAll(/<str:Dimension\s([^>]*)>([\s\S]*?)<\/str:Dimension>/gu)) {
    const [, tag = "", body = ""] = match;
    const id = attribute(` ${tag}`, "id");
    const position = Number(attribute(` ${tag}`, "position"));
    if (!id || !Number.isInteger(position)) continue;
    const codelist = /<Ref\b[^>]*\sid="([^"]+)"[^>]*class="Codelist"/u.exec(body)?.[1] ?? null;
    dimensions.push({ id, position, codelist });
  }
  return dimensions.sort((a, b) => a.position - b.position);
}

/** Every dataflow the portal publishes, across its agencies. */
export async function fetchDataflows(cache: Cache, signal: AbortSignal): Promise<Dataflow[]> {
  return withCache(cache, cacheKey("ecb:dataflows", "all"), STRUCTURE_TTL, async () => {
    const xml = await fetchText("dataflow", {}, "application/xml", signal);
    const flows = parseDataflows(xml);
    if (flows.length === 0) throw new UpstreamError("The ECB's list of dataflows came back empty.");
    return flows;
  });
}

/** One flow with the dimensions of its key, which is what validating a key needs. */
export async function fetchStructure(flow: string, cache: Cache, signal: AbortSignal): Promise<FlowStructure> {
  return withCache(cache, cacheKey("ecb:structure", flow), STRUCTURE_TTL, async () => {
    const xml = await fetchText(
      `dataflow/all/${flow}/latest`,
      { references: "datastructure" },
      "application/xml",
      signal,
    );
    const [dataflow] = parseDataflows(xml);
    const dimensions = parseDimensions(xml);
    if (!dataflow || dimensions.length === 0) {
      throw new NotFoundError(`The ECB has no dataflow "${flow}". search_dataflows lists them.`);
    }
    return { ...dataflow, dimensions };
  });
}

/* -------------------------------------------------------------------------- */
/* Data (SDMX-JSON 1.0)                                                       */
/* -------------------------------------------------------------------------- */

interface RawValue {
  id?: string;
  name?: string;
}

interface RawComponent {
  id: string;
  name?: string;
  keyPosition?: number;
  values?: RawValue[];
}

interface RawSeries {
  attributes?: (number | null)[];
  observations?: Record<string, (number | string | null)[]>;
}

interface RawMessage {
  dataSets?: { series?: Record<string, RawSeries> }[];
  structure?: {
    name?: string;
    dimensions?: { dataSet?: RawComponent[]; series?: RawComponent[]; observation?: RawComponent[] };
    attributes?: { series?: RawComponent[]; observation?: RawComponent[] };
  };
}

export interface Coded {
  code: string | null;
  name: string | null;
}

export interface Observation {
  period: string;
  /** Null where the ECB withholds or never collected the value; `status` says which. */
  value: number | null;
  /** Upstream's OBS_STATUS where it is not A (normal): E estimated, P provisional, Q suppressed… */
  status?: Coded;
  comment?: string;
}

export interface Series {
  key: string;
  dimensions: Record<string, Coded>;
  /** Series-level attributes by id: TITLE, TITLE_COMPL, UNIT, UNIT_MULT, DECIMALS, SOURCE_AGENCY… */
  attributes: Record<string, Coded>;
  observations: Observation[];
}

function coded(value: RawValue | undefined): Coded | undefined {
  if (!value) return undefined;
  return { code: value.id ?? null, name: value.name ?? null };
}

/**
 * SDMX-JSON stores everything by position. A series is keyed `"0:3:0:0:0"`,
 * each number an index into that dimension's `values`; its `attributes` are
 * indexes into each attribute's `values`, null where unset; and each
 * observation is `{ "<time index>": [value, ...observation attribute indexes] }`.
 * This undoes all three into named, labelled series.
 */
export function decodeMessage(raw: RawMessage): Series[] {
  const structure = raw.structure ?? {};
  const datasetDims = structure.dimensions?.dataSet ?? [];
  const seriesDims = structure.dimensions?.series ?? [];
  const timeValues = structure.dimensions?.observation?.[0]?.values ?? [];
  const seriesAttrs = structure.attributes?.series ?? [];
  const obsAttrs = structure.attributes?.observation ?? [];

  // Key order: dimensions fixed for the whole message (one value each) and
  // those varying per series, placed by `keyPosition` where upstream gives it.
  const ordered = [
    ...datasetDims.map((dim) => ({ dim, fixed: true })),
    ...seriesDims.map((dim) => ({ dim, fixed: false })),
  ];
  if (ordered.every(({ dim }) => typeof dim.keyPosition === "number")) {
    ordered.sort((a, b) => (a.dim.keyPosition ?? 0) - (b.dim.keyPosition ?? 0));
  }

  const out: Series[] = [];
  for (const [index, rawSeries] of Object.entries(raw.dataSets?.[0]?.series ?? {})) {
    const positions = index.split(":").map(Number);
    const dimensions: Record<string, Coded> = {};
    const codes: string[] = [];

    for (const { dim, fixed } of ordered) {
      const position = fixed ? 0 : positions[seriesDims.indexOf(dim)];
      const value = coded(position === undefined ? undefined : dim.values?.[position]) ?? { code: null, name: null };
      dimensions[dim.id] = value;
      codes.push(value.code ?? "");
    }

    const attributes: Record<string, Coded> = {};
    (rawSeries.attributes ?? []).forEach((valueIndex, i) => {
      const definition = seriesAttrs[i];
      if (valueIndex === null || !definition) return;
      const value = coded(definition.values?.[valueIndex]);
      if (value) attributes[definition.id] = value;
    });

    const observations: Observation[] = [];
    for (const [timeIndex, cells] of Object.entries(rawSeries.observations ?? {})) {
      const period = timeValues[Number(timeIndex)]?.id;
      if (period === undefined) continue;
      const [rawValue, ...attributeIndexes] = cells;
      const observation: Observation = {
        period,
        value: typeof rawValue === "number" ? rawValue : rawValue === null || rawValue === undefined ? null : Number(rawValue),
      };
      attributeIndexes.forEach((valueIndex, i) => {
        const definition = obsAttrs[i];
        if (valueIndex === null || typeof valueIndex !== "number" || !definition) return;
        const value = coded(definition.values?.[valueIndex]);
        if (!value) return;
        if (definition.id === "OBS_STATUS" && value.code !== "A") observation.status = value;
        if (definition.id === "OBS_COM" && value.name) observation.comment = value.name;
      });
      observations.push(observation);
    }
    observations.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

    out.push({ key: codes.join("."), dimensions, attributes, observations });
  }

  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export interface DataQuery {
  flow: string;
  key: string;
  startPeriod?: string | undefined;
  endPeriod?: string | undefined;
  lastObservations?: number | undefined;
  /** `nodata`: the series and their attributes, no observations — the series list. */
  detail?: "nodata";
}

/** Series matching a key, decoded. An empty list means the key matched but the window held nothing. */
export async function fetchData(query: DataQuery, cache: Cache, ttl: number, signal: AbortSignal): Promise<Series[]> {
  return withCache(cache, cacheKey("ecb:data", query), ttl, async () => {
    const text = await fetchText(
      query.key === "" ? `data/${query.flow}` : `data/${query.flow}/${query.key}`,
      {
        format: "jsondata",
        startPeriod: query.startPeriod,
        endPeriod: query.endPeriod,
        lastNObservations: query.lastObservations,
        detail: query.detail,
      },
      "application/json",
      signal,
    );
    if (text.trim() === "") return [];
    let raw: RawMessage;
    try {
      raw = JSON.parse(text) as RawMessage;
    } catch (cause) {
      throw new UpstreamError("The ECB returned a body that is not valid JSON.", { cause, details: { preview: text.slice(0, 200) } });
    }
    return decodeMessage(raw);
  });
}

/* -------------------------------------------------------------------------- */
/* Reading a series                                                           */
/* -------------------------------------------------------------------------- */

/** An attribute's name, falling back to its code; null where the series does not set it. */
export function attributeText(series: Series, id: string): string | null {
  const value = series.attributes[id];
  return value?.name ?? value?.code ?? null;
}

/**
 * How long after its last period a series of each frequency can go before it
 * reads as discontinued rather than late. Generous: Greek bank rates trail by
 * two months and quarterly supervisory data by two quarters.
 */
const STALE_AFTER_DAYS: Record<string, number> = { D: 30, B: 30, W: 60, M: 270, Q: 400, H: 600, S: 600, A: 900 };

/** Whether the series stopped: its last observation is far older than its frequency allows. */
export function isStale(series: Series, now: Date = new Date()): boolean {
  const last = series.observations.at(-1)?.period;
  if (last === undefined) return false;
  const bounds = periodBounds(last);
  if (!bounds) return false;
  const frequency = series.dimensions.FREQ?.code ?? (last.length === 10 ? "D" : "M");
  const allowed = STALE_AFTER_DAYS[frequency] ?? 900;
  return now.getTime() - bounds.end.getTime() > allowed * 86_400_000;
}

/**
 * Data the ECB republishes but does not own. Its reuse policy does not cover
 * these: financial-market series sourced from a vendor (any `PROVIDER_FM`
 * other than the ECB's own `4F` — Euribor comes from Refinitiv), and the DCM
 * flow, which is Dealogic's.
 */
export function thirdPartyNote(flow: string, series: Series): string | null {
  if (flow === "DCM") {
    return "This flow is Dealogic's data, republished by the ECB. The ECB's free-reuse policy does not cover third-party data; ask the originator before republishing it.";
  }
  const provider = series.dimensions.PROVIDER_FM;
  if (provider?.code && provider.code !== "4F") {
    return `${series.key} is provided by ${provider.name ?? provider.code}, not the ECB. The ECB's free-reuse policy does not cover third-party data; ask the originator before republishing it.`;
  }
  return null;
}
