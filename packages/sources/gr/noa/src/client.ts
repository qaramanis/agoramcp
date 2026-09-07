import {
  cacheKey,
  createHttpClient,
  InvalidInputError,
  isAgoraError,
  NotFoundError,
  UpstreamError,
  UpstreamUnavailableError,
  withCache,
  type Cache,
  type QueryParams,
  type RequestOptions,
} from "@agoramcp/core";

/**
 * One upstream: the National Observatory of Athens EIDA node, speaking the
 * FDSN standard `fdsnws-event` protocol. No credential, no registration.
 *
 * The protocol is international, so nothing here is reverse-engineered — the
 * node publishes its own `application.wadl` and answers the same parameters
 * every seismological data centre does. What is specific to this node is how
 * it behaves under load, which the rest of this file is largely about.
 */
export const API_URL = "https://eida.gein.noa.gr/fdsnws/event/1/";

/**
 * The catalogue opens on 1 February 2011, and the first event in it is
 * `11F00205` at 00:01:56 that morning. Every window before that answers 204
 * with no magnitude filter at all, so the emptiness is the register's rather
 * than the earth's — the earlier Greek record exists, in the Institute's
 * published bulletins, but not in this service.
 */
export const CATALOGUE_START = "2011-02-01T00:00:00Z";

/**
 * The hard limit on a search window, and the single most important number in
 * this file.
 *
 * This node scans the whole window before it answers, so cost follows the
 * window rather than the number of results. Measured: 7 days answers in 0.3 s,
 * 30 days of one region in 5 s, 90 days in 10 s, and twelve months returns
 * nothing at all — 45 and 90 second attempts both ended with zero bytes, and
 * the second one left the service returning 503 to every caller for minutes
 * afterwards. `limit` does not rescue a wide window; it only helps once the
 * window is already short.
 *
 * So the window is capped where the service is still reliable, and a caller
 * who wants more is told to ask in instalments rather than being handed a
 * timeout. Historical windows are the slow end even inside the cap — a month
 * of 2014 took 21 s where a month of last summer took 5 s.
 */
export const MAX_WINDOW_DAYS = 31;

/**
 * Below this, a window is cheap enough that one retry costs less than a
 * failure. Above it, a retry re-runs the expensive scan that just timed out,
 * which is precisely what tips this node into 503 — so wider windows get one
 * attempt and a message that says what to do instead.
 */
const CHEAP_WINDOW_DAYS = 2;

const api = createHttpClient({
  baseUrl: API_URL,
  timeoutMs: 25_000,
  retries: 0,
});

const MS_PER_DAY = 86_400_000;

/** One degree of great circle. FDSN takes radii in degrees; people think in km. */
const KM_PER_DEGREE = 111.195;

/* -------------------------------------------------------------------------- */
/* Time and windows                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Reads the ways a caller writes a moment. A bare date is the start of that
 * day, and a time with no zone is UTC — the catalogue is timed in UTC
 * throughout, and guessing a local zone would silently shift every result.
 */
export function parseTime(value: string, field: string): Date {
  const trimmed = value.trim();
  const dated = /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
  const zoned = /(?:[Zz]|[+-]\d{2}:?\d{2})$/u.test(dated) ? dated : `${dated}Z`;

  const at = new Date(zoned);
  if (Number.isNaN(at.getTime())) {
    throw new InvalidInputError(
      `${field} is not a time this can read: "${value}". Write a date, 2026-09-01, or a moment, 2026-09-01T14:30:00. Times with no zone are read as UTC.`,
    );
  }
  return at;
}

export interface TimeWindow {
  start: Date;
  end: Date;
  /** Length in days, as the cap is expressed. */
  days: number;
}

/** FDSN wants `YYYY-MM-DDTHH:MM:SS` and reads it as UTC. */
function fdsnTime(at: Date): string {
  return at.toISOString().replace(/\.\d+Z$/u, "");
}

/**
 * The window a search will actually run over, refusing the ones this node
 * cannot serve. `defaultDays` back from the end is what a caller who gave
 * neither bound meant.
 */
export function resolveWindow(
  startTime: string | undefined,
  endTime: string | undefined,
  defaultDays: number,
  now: Date = new Date(),
): TimeWindow {
  const end = endTime === undefined ? now : parseTime(endTime, "endTime");
  const start =
    startTime === undefined
      ? new Date(end.getTime() - defaultDays * MS_PER_DAY)
      : parseTime(startTime, "startTime");

  if (start.getTime() >= end.getTime()) {
    throw new InvalidInputError(
      `startTime (${start.toISOString()}) is not before endTime (${end.toISOString()}).`,
    );
  }

  const days = (end.getTime() - start.getTime()) / MS_PER_DAY;
  if (days > MAX_WINDOW_DAYS) {
    throw new InvalidInputError(
      `That window is ${days.toFixed(0)} days. This catalogue scans the whole window before it answers, and past about ${MAX_WINDOW_DAYS} days it times out rather than returning slowly — a twelve-month query returned nothing after 90 seconds and left the service unavailable to everyone for minutes. Ask for at most ${MAX_WINDOW_DAYS} days at a time and walk the window back; narrowing by magnitude or region does not lift this, because the cost is in the window.`,
      { details: { requestedDays: Math.round(days), maxDays: MAX_WINDOW_DAYS } },
    );
  }

  return { start, end, days };
}

/**
 * A window that closed a week ago is settled — solutions are revised in the
 * hours after an event, not the months. Holding those for a day is what makes
 * historical searches, the slow ones, cheap the second time they are asked.
 */
export function ttlForWindow(window: TimeWindow, ttl: number, now: number = Date.now()): number {
  const closedDaysAgo = (now - window.end.getTime()) / MS_PER_DAY;
  return closedDaysAgo >= 7 ? Math.max(ttl, 86_400) : ttl;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Any subset of the four edges. FDSN treats each independently, so "north of
 * 38°" is as valid a region as a closed rectangle, and refusing the open ones
 * would be a restriction this adapter invented.
 */
export interface BoundingBox {
  minLatitude?: number | undefined;
  maxLatitude?: number | undefined;
  minLongitude?: number | undefined;
  maxLongitude?: number | undefined;
}

export interface Circle {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/** Great-circle distance, for reporting how far an event fell from a search centre. */
export function distanceKm(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (toLat - fromLat) * toRad;
  const dLon = (toLon - fromLon) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat * toRad) * Math.cos(toLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 6_371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

/** Initial bearing from one point to another, as a compass point. */
export function bearing(fromLat: number, fromLon: number, toLat: number, toLon: number): string {
  const toRad = Math.PI / 180;
  const dLon = (toLon - fromLon) * toRad;
  const y = Math.sin(dLon) * Math.cos(toLat * toRad);
  const x =
    Math.cos(fromLat * toRad) * Math.sin(toLat * toRad) -
    Math.sin(fromLat * toRad) * Math.cos(toLat * toRad) * Math.cos(dLon);
  const degrees = (Math.atan2(y, x) / toRad + 360) % 360;
  return COMPASS[Math.round(degrees / 22.5) % 16] ?? "N";
}

/* -------------------------------------------------------------------------- */
/* The catalogue row                                                          */
/* -------------------------------------------------------------------------- */

export interface Quake {
  /** The catalogue's own id, `noa2026rnaeb`. Case-sensitive upstream. */
  id: string;
  /** Origin time, UTC. Microsecond precision, as the catalogue keeps it. */
  time: string;
  latitude: number;
  longitude: number;
  /** Below the surface, in kilometres. */
  depthKm: number | null;
  magnitude: number | null;
  /** `MLh` — the local magnitude scale calibrated for Greece. */
  magnitudeType: string | null;
  /** The catalogue's own words: "Crete, Greece", "Aegean Sea", "Albania". */
  region: string | null;
  /** `earthquake`, and rarely something else — an explosion is not a quake. */
  eventType: string | null;
  /** `NOAIG`, the Institute of Geodynamics. */
  contributor: string | null;
  /** The record itself, so any answer can be checked against the register. */
  recordUrl: string;
}

/** How far from the centre of a radius search this event fell. */
export interface QuakeNearPoint extends Quake {
  distanceKm: number;
  /** Compass direction from the search centre, e.g. "SW". */
  direction: string;
}

const HEADER_MARK = "#";

/**
 * The `text` format: a `#`-prefixed header naming the columns, then one
 * pipe-separated row per event. Read by column name rather than by position,
 * so a column added upstream shifts nothing.
 */
export function parseCatalogue(body: string): Quake[] {
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length === 0) return [];

  const headerLine = lines.find((line) => line.startsWith(HEADER_MARK));
  if (headerLine === undefined) {
    throw new UpstreamError(
      "The catalogue answered without its column header, so the rows cannot be read by name.",
      { details: { preview: lines[0]?.slice(0, 200) } },
    );
  }

  const columns = headerLine.slice(HEADER_MARK.length).split("|").map((name) => name.trim());
  const index = new Map(columns.map((name, position) => [name, position]));

  const quakes: Quake[] = [];
  for (const line of lines) {
    if (line.startsWith(HEADER_MARK)) continue;

    const cells = line.split("|");
    const field = (name: string): string | undefined => {
      const position = index.get(name);
      return position === undefined ? undefined : cells[position];
    };

    const id = text(field("EventID"));
    const latitude = toNumber(field("Latitude"));
    const longitude = toNumber(field("Longitude"));
    const time = field("Time");

    // A row without an id or a position is not an event we can report or that
    // a caller could look up again. Upstream has never sent one; dropping it
    // is still better than emitting a hole in the middle of a result set.
    if (id === null || latitude === null || longitude === null || time === undefined) continue;

    quakes.push({
      id,
      time: utc(time),
      latitude: round(latitude, 4) ?? latitude,
      longitude: round(longitude, 4) ?? longitude,
      depthKm: round(toNumber(field("Depth/km")), 1),
      magnitude: round(toNumber(field("Magnitude")), 1),
      magnitudeType: text(field("MagType")),
      region: text(field("EventLocationName")),
      eventType: text(field("EventType")),
      contributor: text(field("Contributor")),
      recordUrl: recordUrl(id),
    });
  }

  return quakes;
}

/**
 * The `text` format writes origin times with no zone at all, where the same
 * event in `csv` and in QuakeML carries a `Z`. They are UTC either way — this
 * puts the marker back so nothing downstream reads them as local.
 */
function utc(value: string): string {
  const trimmed = value.trim();
  return /(?:[Zz]|[+-]\d{2}:?\d{2})$/u.test(trimmed) ? trimmed : `${trimmed}Z`;
}

function recordUrl(id: string): string {
  return `${API_URL}query?eventid=${encodeURIComponent(id)}&format=xml`;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Magnitudes and depths arrive with ten decimal places, which is the solver's
 * working precision rather than a claim about the earthquake: this event's own
 * depth is uncertain by 1.6 km. Reporting them the way a seismological
 * bulletin does keeps the false precision out of the answer.
 */
function round(value: number | null, places: number): number | null {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export type OrderBy = "time" | "time-asc" | "magnitude" | "magnitude-asc";

export interface SearchCriteria {
  window: TimeWindow;
  minMagnitude?: number | undefined;
  maxMagnitude?: number | undefined;
  minDepthKm?: number | undefined;
  maxDepthKm?: number | undefined;
  box?: BoundingBox | undefined;
  circle?: Circle | undefined;
  orderBy: OrderBy;
  limit: number;
}

export interface SearchResult {
  quakes: Quake[];
  /** True when the answer stopped at `limit` and there may be more. */
  truncated: boolean;
}

/**
 * One search. Cached on the criteria, so the same question inside a session —
 * or from two callers at once, which `withCache` collapses into one request —
 * costs this node a single scan.
 */
export async function searchQuakes(
  criteria: SearchCriteria,
  cache: Cache,
  ttl: number,
  signal: AbortSignal,
): Promise<SearchResult> {
  return withCache(cache, cacheKey("noa:search", asKey(criteria)), ttl, async () => {
    const body = await getCatalogue(queryFor(criteria), criteria.window, signal, "that search");
    const quakes = parseCatalogue(body);
    return { quakes, truncated: quakes.length >= criteria.limit };
  });
}

/** Dates do not survive `cacheKey`'s stable stringify as themselves. */
function asKey(criteria: SearchCriteria): Record<string, unknown> {
  const { window, ...rest } = criteria;
  return { ...rest, start: window.start.toISOString(), end: window.end.toISOString() };
}

function queryFor(criteria: SearchCriteria): QueryParams {
  return {
    format: "text",
    starttime: fdsnTime(criteria.window.start),
    endtime: fdsnTime(criteria.window.end),
    minmagnitude: criteria.minMagnitude,
    maxmagnitude: criteria.maxMagnitude,
    mindepth: criteria.minDepthKm,
    maxdepth: criteria.maxDepthKm,
    minlatitude: criteria.box?.minLatitude,
    maxlatitude: criteria.box?.maxLatitude,
    minlongitude: criteria.box?.minLongitude,
    maxlongitude: criteria.box?.maxLongitude,
    latitude: criteria.circle?.latitude,
    longitude: criteria.circle?.longitude,
    // FDSN takes a radius in degrees of arc; the tool takes kilometres,
    // because nobody asks "within 0.9 degrees of Athens".
    maxradius:
      criteria.circle === undefined
        ? undefined
        : Number((criteria.circle.radiusKm / KM_PER_DEGREE).toFixed(6)),
    orderby: criteria.orderBy,
    // Always sent. With `orderby=time` this node can stop at the newest N
    // instead of assembling everything in the window, which is the difference
    // between a quarter of a second and several seconds on a week of data.
    limit: criteria.limit,
  };
}

/* -------------------------------------------------------------------------- */
/* One event, in full                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What the catalogue knows about the solution itself: how many stations saw
 * it, how well they surrounded it, and whether a person confirmed it. Every
 * field is nullable — this comes out of a QuakeML document, and a field the
 * solver did not fill is absent rather than zero.
 */
export interface SolutionQuality {
  /** `manual` where an analyst reviewed the solution, `automatic` where not. */
  evaluationMode: string | null;
  /** `confirmed`, `reviewed`, `preliminary` — the analyst's verdict. */
  evaluationStatus: string | null;
  /** Seismic stations whose readings were used. */
  usedStationCount: number | null;
  /** Individual P and S arrivals used, and how many were associated at all. */
  usedPhaseCount: number | null;
  associatedPhaseCount: number | null;
  /** Root-mean-square of the arrival-time residuals, in seconds. Smaller is better. */
  rmsSeconds: number | null;
  /**
   * The widest angle around the epicentre with no station in it. Under 180°
   * the event is surrounded; this one at 200° was located from one side, which
   * is why its position is uncertain by kilometres.
   */
  azimuthalGapDegrees: number | null;
  /** How far the epicentre could be out, in kilometres. */
  horizontalUncertaintyKm: number | null;
  depthUncertaintyKm: number | null;
  /** How far the magnitude could be out, and how many stations set it. */
  magnitudeUncertainty: number | null;
  magnitudeStationCount: number | null;
}

export interface QuakeDetail extends Quake {
  /** `known` where the catalogue is sure it was an earthquake. */
  eventTypeCertainty: string | null;
  quality: SolutionQuality;
  /**
   * The working group that produced this solution, which is not always the
   * network that catalogued it: `NOAreg1` inside `NOAIG`.
   */
  agency: string | null;
  /** The analyst credited with the reviewed solution, as the catalogue names them. */
  author: string | null;
  updatedAt: string | null;
  /** The velocity model the location was computed against, e.g. `ak135`. */
  earthModel: string | null;
}

/**
 * Ids are opaque and their shape changed with the software behind the
 * register: `noa2020vipzs` for recent events, `11F00205` and `01F07929` for
 * the Atlas years. Matching is exact — `NOA2026RNAEB` finds nothing where
 * `noa2026rnaeb` finds the event — so this only rejects what could not be an
 * id at all rather than enforcing a shape upstream does not keep.
 */
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,60}$/u;

export async function fetchQuake(
  id: string,
  cache: Cache,
  ttl: number,
  signal: AbortSignal,
): Promise<QuakeDetail> {
  const trimmed = id.trim();
  if (!EVENT_ID.test(trimmed)) {
    throw new InvalidInputError(
      `"${id}" cannot be a catalogue id. Use the id from any result of search_earthquakes — noa2026rnaeb for a recent event, 11F00205 for one from the early years.`,
    );
  }

  return withCache(cache, cacheKey("noa:event", trimmed), ttl, async () => {
    // QuakeML rather than the tabular format: the row is in here too, and
    // everything about how well the event is located is only in here.
    const body = await getCatalogue(
      { format: "xml", eventid: trimmed },
      undefined,
      signal,
      `event ${trimmed}`,
    );

    if (body.trim() === "") {
      throw new NotFoundError(
        `No event is catalogued under id "${trimmed}". Ids are matched exactly, so copy the case as well — noa2026rnaeb finds the event where NOA2026RNAEB finds nothing — and this catalogue begins on 1 February 2011.`,
        { details: { id: trimmed } },
      );
    }

    return parseQuakeML(body, trimmed);
  });
}

/* -------------------------------------------------------------------------- */
/* QuakeML                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A deliberately small reader for one machine-generated document.
 *
 * QuakeML is XML, and this workspace carries no XML parser — the sources so
 * far have needed none. Rather than take a dependency for one tool, this pulls
 * the twenty-odd scalars it wants out of named elements within a named parent.
 * That is safe here and would not be in general: the document comes from
 * SeisComP, has no attributes worth reading, no mixed content and no CDATA,
 * and every field below is optional, so a shape that changes upstream returns
 * nulls rather than throwing.
 */
function element(scope: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "u").exec(scope);
  return match?.[1] ?? null;
}

function elements(scope: string, tag: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gu");
  let match = pattern.exec(scope);
  while (match !== null) {
    if (match[1] !== undefined) found.push(match[1]);
    match = pattern.exec(scope);
  }
  return found;
}

/**
 * A block with its nested children removed, so an element's own text can be
 * read without reaching into a child's. The event carries `<type>earthquake`,
 * but its description carries `<type>region name` and its magnitude
 * `<type>MLh` — first-match-wins would report the wrong one.
 */
function withoutChildren(scope: string, tags: readonly string[]): string {
  let stripped = scope;
  for (const tag of tags) {
    stripped = stripped.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gu"), "");
  }
  return stripped;
}

/** The `publicID` of the block this string opens, when it has one. */
function publicId(scope: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\s[^>]*publicID="([^"]*)"`, "u").exec(scope);
  return match?.[1] ?? null;
}

function childText(scope: string | null, tag: string): string | null {
  if (scope === null) return null;
  const value = element(scope, tag);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

function childNumber(scope: string | null, tag: string): number | null {
  const value = childText(scope, tag);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `<depth><value>13808</value><uncertainty>1600</uncertainty></depth>` */
function quantity(scope: string | null, tag: string): { value: number | null; uncertainty: number | null } {
  if (scope === null) return { value: null, uncertainty: null };
  const inner = element(scope, tag);
  return { value: childNumber(inner, "value"), uncertainty: childNumber(inner, "uncertainty") };
}

/** The block whose `publicID` the event prefers, or the only one there is. */
function preferred(scope: string, tag: string, preferredId: string | null): string | null {
  const raw = scope.split(new RegExp(`(?=<${tag}\\s)`, "u")).filter((part) => part.startsWith(`<${tag}`));
  const blocks = raw.map((part) => ({ id: publicId(part, tag), body: element(part, tag) }));
  if (preferredId !== null) {
    const match = blocks.find((block) => block.id === preferredId);
    if (match?.body != null) return match.body;
  }
  return blocks[0]?.body ?? element(scope, tag);
}

export function parseQuakeML(body: string, requestedId: string): QuakeDetail {
  const event = element(body, "event");
  if (event === null) {
    throw new UpstreamError(`The catalogue returned a document with no event in it for "${requestedId}".`);
  }

  const origin = preferred(event, "origin", childText(event, "preferredOriginID"));
  const magnitude = preferred(event, "magnitude", childText(event, "preferredMagnitudeID"));
  const quality = origin === null ? null : element(origin, "quality");
  const uncertainty = origin === null ? null : element(origin, "originUncertainty");

  // The event's own creationInfo is the automatic pipeline that first
  // detected it; the origin's is the analyst who reviewed it. The second is
  // the one worth reporting, and it falls back to the first.
  const originInfo = origin === null ? null : element(origin, "creationInfo");
  const eventInfo = element(event, "creationInfo");

  const time = childText(origin === null ? null : element(origin, "time"), "value");
  const latitude = quantity(origin, "latitude").value;
  const longitude = quantity(origin, "longitude").value;
  const depth = quantity(origin, "depth");
  const mag = quantity(magnitude, "mag");

  if (time === null || latitude === null || longitude === null) {
    throw new UpstreamError(
      `The record for "${requestedId}" carries no origin time or position.`,
      { details: { id: requestedId } },
    );
  }

  // The catalogue id round-trips through the event's publicID as its last
  // path segment: `smi:…/geofon/noa2026rnaeb`. Read from the whole document,
  // because `element` hands back inner content without the attributes.
  const catalogueId = lastSegment(publicId(body, "event")) ?? requestedId;

  // The event's agency is the network that catalogued it, `NOAIG`, and is what
  // the tabular format calls the Contributor. The origin's is the working
  // group that produced this particular solution, `NOAreg1`. They differ.
  const own = withoutChildren(event, ["description", "creationInfo", "magnitude", "origin", "focalMechanism"]);

  return {
    id: catalogueId,
    time: utc(time),
    latitude: round(latitude, 4) ?? latitude,
    longitude: round(longitude, 4) ?? longitude,
    // QuakeML measures depth in metres where the tabular format uses km.
    depthKm: round(depth.value === null ? null : depth.value / 1_000, 1),
    magnitude: round(mag.value, 1),
    magnitudeType: childText(magnitude, "type"),
    region: regionOf(event),
    eventType: childText(own, "type"),
    contributor: childText(eventInfo, "agencyID"),
    recordUrl: recordUrl(catalogueId),
    eventTypeCertainty: childText(own, "typeCertainty"),
    agency: childText(originInfo, "agencyID") ?? childText(eventInfo, "agencyID"),
    author: childText(originInfo, "author"),
    updatedAt: childText(originInfo, "creationTime") ?? childText(eventInfo, "creationTime"),
    earthModel: lastSegment(childText(origin, "earthModelID")),
    quality: {
      evaluationMode: childText(origin, "evaluationMode"),
      evaluationStatus: childText(origin, "evaluationStatus"),
      usedStationCount: childNumber(quality, "usedStationCount"),
      usedPhaseCount: childNumber(quality, "usedPhaseCount"),
      associatedPhaseCount: childNumber(quality, "associatedPhaseCount"),
      rmsSeconds: round(childNumber(quality, "standardError"), 2),
      azimuthalGapDegrees: round(childNumber(quality, "azimuthalGap"), 0),
      // Three fields in this document are deliberately not reported, because
      // no single unit reads them correctly across the register.
      //
      // `minimumDistance`/`maximumDistance` are degrees of arc per the
      // QuakeML spec, and the modern records agree — 0.45° is a station 50 km
      // out, which is what a network this dense looks like. The Atlas-era
      // records do not: the 2012 event 01F07929 gives 55, which is a station
      // 55 km away in kilometres and an impossible 6,116 km in degrees. The
      // same field changes unit somewhere between the two eras.
      //
      // The per-axis latitude and longitude uncertainties fail differently:
      // read as degrees they put the Samos epicentre out by 97 km, in a
      // record whose own `horizontalUncertainty` says 1.9 km.
      //
      // A guessed unit here would be a number that looks like evidence, so
      // these are left out and the fields below — which read sanely in every
      // record checked — carry the confidence instead.
      horizontalUncertaintyKm: round(
        metresToKm(childNumber(uncertainty, "horizontalUncertainty")),
        1,
      ),
      depthUncertaintyKm: round(metresToKm(depth.uncertainty), 1),
      magnitudeUncertainty: round(mag.uncertainty, 2),
      magnitudeStationCount: childNumber(magnitude, "stationCount"),
    },
  };
}

/** The place name, which QuakeML files under a description typed "region name". */
function regionOf(event: string): string | null {
  for (const description of elements(event, "description")) {
    if (childText(description, "type") === "region name") return childText(description, "text");
  }
  return childText(element(event, "description"), "text");
}

/** `smi:org.gfz-potsdam.de/geofon/AK135` is a URI whose useful part is the end. */
function lastSegment(value: string | null): string | null {
  if (value === null) return null;
  return /([^/]+)$/u.exec(value)?.[1] ?? value;
}

function metresToKm(value: number | null): number | null {
  return value === null ? null : value / 1_000;
}

/* -------------------------------------------------------------------------- */
/* Talking to the node                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Every request goes through here, for the two things this node does that a
 * caller must not see raw: it answers 204 with an empty body where there is
 * nothing to report, and when it is overloaded it fails in ways whose only
 * useful remedy is a narrower question.
 */
async function getCatalogue(
  query: QueryParams,
  window: TimeWindow | undefined,
  signal: AbortSignal,
  what: string,
): Promise<string> {
  const options: RequestOptions = {
    query,
    signal,
    headers: { accept: "text/plain, application/xml" },
    ...(window !== undefined && window.days > CHEAP_WINDOW_DAYS
      ? { timeoutMs: 25_000, retries: 0 }
      : { timeoutMs: 15_000, retries: 1 }),
  };

  try {
    return await api.getText("query", options);
  } catch (error) {
    throw explain(error, what, window);
  }
}

function explain(error: unknown, what: string, window: TimeWindow | undefined): unknown {
  if (!isAgoraError(error)) return error;

  // A 400 here is an argument this adapter built, not one the caller wrote:
  // the node answers it with an Apache error page carrying no reason at all,
  // so there is nothing to pass on but the fact.
  if (error.status === 400) {
    return new UpstreamError(
      `The catalogue rejected ${what} without saying why — it answers a bad argument with a bare 400. This is a fault in the adapter rather than in the question.`,
      { status: 400, cause: error },
    );
  }

  if (error.code === "upstream_timeout" || error.status === 503 || error.status === 502) {
    const narrower =
      window === undefined
        ? "Try again in a few minutes."
        : `The window asked for was ${window.days.toFixed(1)} days; a few days answers in well under a second, where a month of older data can take twenty seconds. Narrow the window, or the region, and try again.`;

    return new UpstreamUnavailableError(
      `The NOA catalogue did not answer ${what}. This is one node serving the whole Greek record, and it degrades under load rather than queueing — a heavy query can leave it returning 503 to everyone for a few minutes. ${narrower}`,
      { cause: error, details: { days: window?.days } },
    );
  }

  return error;
}
