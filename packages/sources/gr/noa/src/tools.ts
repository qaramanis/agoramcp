import { defineTool, InvalidInputError } from "@agoramcp/core";
import { z } from "zod";
import {
  bearing,
  CATALOGUE_START,
  distanceKm,
  fetchQuake,
  MAX_WINDOW_DAYS,
  resolveWindow,
  searchQuakes,
  ttlForWindow,
  type BoundingBox,
  type Circle,
  type OrderBy,
  type Quake,
  type QuakeNearPoint,
  type SearchResult,
  type TimeWindow,
} from "./client.ts";

const MAX_RESULTS = 500;
const DEFAULT_RESULTS = 50;

/** A week back is what "recently" means for a country with daily seismicity. */
const DEFAULT_WINDOW_DAYS = 7;

const MAX_RECENT = 200;
const DEFAULT_RECENT = 20;
const MAX_RECENT_HOURS = 168;
const DEFAULT_RECENT_HOURS = 24;

/* -------------------------------------------------------------------------- */
/* Shared argument shapes                                                     */
/* -------------------------------------------------------------------------- */

const magnitude = (bound: "smallest" | "largest") =>
  z
    .number()
    .min(-2)
    .max(10)
    .optional()
    .describe(
      `The ${bound} magnitude to include, on the MLh local scale this catalogue uses. Most of what it records is under 2 and imperceptible; 3.5 is widely felt, 5 does damage, and the largest Greek earthquake since the register opened is the 6.7 off Samos in 2020.`,
    );

const depth = (bound: "shallowest" | "deepest") =>
  z
    .number()
    .min(0)
    .max(800)
    .optional()
    .describe(
      `The ${bound} focal depth to include, in kilometres below the surface. Most Greek seismicity is in the top 20 km; the Hellenic subduction zone puts events under the southern Aegean as deep as 150 km, and a deep one is felt far more weakly at the surface than a shallow one of the same size.`,
    );

const latitude = (edge: string) =>
  z.number().min(-90).max(90).optional().describe(`${edge} of a bounding box, in degrees. Greece spans roughly 34° to 42° north.`);

const longitude = (edge: string) =>
  z.number().min(-180).max(180).optional().describe(`${edge} of a bounding box, in degrees. Greece spans roughly 19° to 30° east.`);

/* -------------------------------------------------------------------------- */
/* Region                                                                     */
/* -------------------------------------------------------------------------- */

interface RegionArgs {
  minLatitude?: number | undefined;
  maxLatitude?: number | undefined;
  minLongitude?: number | undefined;
  maxLongitude?: number | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  radiusKm?: number | undefined;
}

interface Region {
  box: BoundingBox | undefined;
  circle: Circle | undefined;
}

/**
 * A box or a circle, never both — upstream would apply them at once and
 * silently answer a question nobody asked. A circle needs all three of its
 * parts, where a box is happy with any of its four edges.
 */
function resolveRegion(args: RegionArgs): Region {
  const edges = [args.minLatitude, args.maxLatitude, args.minLongitude, args.maxLongitude];
  const hasBox = edges.some((edge) => edge !== undefined);
  const parts = [args.latitude, args.longitude, args.radiusKm];
  const given = parts.filter((part) => part !== undefined).length;

  if (hasBox && given > 0) {
    throw new InvalidInputError(
      "Give a bounding box or a centre and radius, not both — they are two ways of saying where, and upstream would apply both at once.",
    );
  }

  if (given > 0 && given < 3) {
    throw new InvalidInputError(
      "A circular search needs all of latitude, longitude and radiusKm. Athens within 50 km is latitude 37.98, longitude 23.73, radiusKm 50.",
    );
  }

  if (given === 3 && args.latitude !== undefined && args.longitude !== undefined && args.radiusKm !== undefined) {
    return {
      box: undefined,
      circle: { latitude: args.latitude, longitude: args.longitude, radiusKm: args.radiusKm },
    };
  }

  if (!hasBox) return { box: undefined, circle: undefined };

  if (
    args.minLatitude !== undefined &&
    args.maxLatitude !== undefined &&
    args.minLatitude >= args.maxLatitude
  ) {
    throw new InvalidInputError("minLatitude must be south of maxLatitude.");
  }
  if (
    args.minLongitude !== undefined &&
    args.maxLongitude !== undefined &&
    args.minLongitude >= args.maxLongitude
  ) {
    throw new InvalidInputError("minLongitude must be west of maxLongitude.");
  }

  return {
    box: {
      minLatitude: args.minLatitude,
      maxLatitude: args.maxLatitude,
      minLongitude: args.minLongitude,
      maxLongitude: args.maxLongitude,
    },
    circle: undefined,
  };
}

/** Where each event fell relative to the centre the caller asked around. */
function locate(quakes: Quake[], circle: Circle): QuakeNearPoint[] {
  return quakes.map((quake) => ({
    ...quake,
    distanceKm: Math.round(distanceKm(circle.latitude, circle.longitude, quake.latitude, quake.longitude)),
    direction: bearing(circle.latitude, circle.longitude, quake.latitude, quake.longitude),
  }));
}

const CATALOGUE_START_MS = Date.parse(CATALOGUE_START);

/** What the caller should know about this answer that the rows do not say. */
function notesFor(window: TimeWindow, result: SearchResult, limit: number, ordered: OrderBy): string[] {
  const notes: string[] = [];

  if (result.silent) {
    notes.push(
      "Nothing came back, and that is the catalogue's fault rather than a quiet period: right now it answers every window with nothing, even the hour of the 2020 Samos earthquake, the largest event it holds. Until it recovers, an empty list from it says nothing about what happened, so do not report this window as quiet. Try again later; the Institute also shows the last day's earthquakes on its own website, www.gein.noa.gr.",
    );
  }

  if (window.end.getTime() <= CATALOGUE_START_MS) {
    notes.push(
      `This window ends before the catalogue opens. The register starts on ${CATALOGUE_START.slice(0, 10)} and its first event is 11F00205; earlier Greek seismicity exists, in the Institute's published bulletins, but not in this service — so nothing here is not a quiet period.`,
    );
  } else if (window.start.getTime() < CATALOGUE_START_MS) {
    notes.push(
      `The window reaches back before ${CATALOGUE_START.slice(0, 10)}, where this catalogue has no records at all. Only the part from that date on is answered.`,
    );
  }

  if (result.truncated) {
    const more =
      ordered === "time"
        ? "the most recent"
        : ordered === "time-asc"
          ? "the earliest"
          : ordered === "magnitude"
            ? "the largest"
            : "the smallest";
    notes.push(
      `Stopped at the limit of ${limit}, so these are ${more} and there are others. Raise limit, or narrow the window or the magnitude range, rather than assuming this is all of them.`,
    );
  }

  return notes;
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

export const searchEarthquakesTool = defineTool({
  name: "search_earthquakes",
  title: "Search the Greek earthquake catalogue",
  description:
    "Find earthquakes the National Observatory of Athens has located, by when, how big, how deep and where. " +
    "This is the register of record for Greek seismicity: solutions are reviewed by an analyst rather than left as automatic alerts, and magnitudes are on the MLh local scale calibrated for Greece, so they will differ by a few tenths from the figure a global agency publishes for the same event. " +
    "Where: either a bounding box, any of its four edges, or a centre and a radius in kilometres — in which case every result also carries how far and in which direction it fell from that centre. " +
    `When: startTime and endTime, read as UTC, defaulting to the last ${DEFAULT_WINDOW_DAYS} days. The window is capped at ${MAX_WINDOW_DAYS} days because this is a single node that scans the whole window before answering and a wider one times out rather than returning slowly; walk the window back in instalments for a longer period. ` +
    "The catalogue begins on 1 February 2011. " +
    "Results are capped and the answer says when it stopped short, so a count from here is a count of what was returned and not of what happened.",
  inputSchema: {
    startTime: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        `Start of the window, as a date (2026-09-01) or a moment (2026-09-01T14:30:00). Read as UTC. Defaults to ${DEFAULT_WINDOW_DAYS} days before endTime.`,
      ),
    endTime: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("End of the window, same format. Read as UTC. Defaults to now."),
    minMagnitude: magnitude("smallest"),
    maxMagnitude: magnitude("largest"),
    minDepthKm: depth("shallowest"),
    maxDepthKm: depth("deepest"),
    minLatitude: latitude("Southern edge"),
    maxLatitude: latitude("Northern edge"),
    minLongitude: longitude("Western edge"),
    maxLongitude: longitude("Eastern edge"),
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe("Centre of a circular search, in degrees. Give with longitude and radiusKm."),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe("Centre of a circular search, in degrees. Give with latitude and radiusKm."),
    radiusKm: z
      .number()
      .min(1)
      .max(5_000)
      .optional()
      .describe("How far around that centre to look, in kilometres."),
    orderBy: z
      .enum(["time", "time-asc", "magnitude", "magnitude-asc"])
      .optional()
      .describe(
        "Newest first (time, the default), oldest first (time-asc), largest first (magnitude) or smallest first (magnitude-asc). This decides which events survive the limit, so ask for magnitude when the question is about the biggest.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS)
      .optional()
      .describe(`Most events to return, 1-${MAX_RESULTS}. Defaults to ${DEFAULT_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { minMagnitude: 3, limit: 10 },
  async handler(input, context) {
    const window = resolveWindow(input.startTime, input.endTime, DEFAULT_WINDOW_DAYS);
    const region = resolveRegion(input);
    const orderBy: OrderBy = input.orderBy ?? "time";
    const limit = input.limit ?? DEFAULT_RESULTS;

    if (
      input.minMagnitude !== undefined &&
      input.maxMagnitude !== undefined &&
      input.minMagnitude > input.maxMagnitude
    ) {
      throw new InvalidInputError("minMagnitude is larger than maxMagnitude, so nothing can match.");
    }
    if (
      input.minDepthKm !== undefined &&
      input.maxDepthKm !== undefined &&
      input.minDepthKm > input.maxDepthKm
    ) {
      throw new InvalidInputError("minDepthKm is deeper than maxDepthKm, so nothing can match.");
    }

    const result = await searchQuakes(
      {
        window,
        minMagnitude: input.minMagnitude,
        maxMagnitude: input.maxMagnitude,
        minDepthKm: input.minDepthKm,
        maxDepthKm: input.maxDepthKm,
        box: region.box,
        circle: region.circle,
        orderBy,
        limit,
      },
      context.cache,
      ttlForWindow(window, context.ttl),
      context.signal,
    );

    return {
      window: { start: window.start.toISOString(), end: window.end.toISOString(), days: Number(window.days.toFixed(2)) },
      orderBy,
      count: result.quakes.length,
      truncated: result.truncated,
      earthquakes:
        region.circle === undefined ? result.quakes : locate(result.quakes, region.circle),
      notes: notesFor(window, result, limit, orderBy),
    };
  },
});

export const getEarthquakeTool = defineTool({
  name: "get_earthquake",
  title: "One earthquake, with the quality of its solution",
  description:
    "Everything the catalogue holds about one earthquake, by the id search_earthquakes returns. " +
    "Beyond the time, place, depth and magnitude, this is where the confidence lives: how many stations recorded it and how far the nearest was, the widest gap in the ring of stations around it, the residual of the fit, how far the epicentre and the depth could be out in kilometres, and whether an analyst reviewed the solution or it is still what the automatic pipeline produced. " +
    "Ask for it before treating a position or a magnitude as settled — an event located from one side, with a large azimuthal gap, can be kilometres from where it is plotted, and solutions are revised for months after the event: the 2020 Samos earthquake was last rewritten five months later. " +
    "Ids are matched exactly, case included.",
  inputSchema: {
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe(
        "The catalogue id, copied from a search result exactly as it appears — noa2020vipzs for a recent event, 11F00205 for one from the early years, and the case matters in both.",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  // The Samos earthquake of 30 October 2020, the largest in the catalogue: a
  // real event, a permanent id, and a solution good enough to show what the
  // quality fields look like when a network surrounds an event properly.
  example: { id: "noa2020vipzs" },
  async handler(input, context) {
    const quake = await fetchQuake(input.id, context.cache, context.ttl, context.signal);

    const notes: string[] = [];
    if (quake.quality.evaluationMode === "automatic") {
      notes.push(
        "This is an automatic solution that no analyst has reviewed. Position, depth and magnitude can all move once it is; treat it as a first report.",
      );
    }
    const gap = quake.quality.azimuthalGapDegrees;
    if (gap !== null && gap >= 180) {
      notes.push(
        `The stations that recorded this cover only ${360 - gap}° around it — an azimuthal gap of ${gap}° means it was located from one side, and the epicentre is correspondingly less certain than the depth or the time.`,
      );
    }
    if (quake.magnitudeType !== null) {
      notes.push(
        `Magnitude ${quake.magnitude ?? "unknown"} is on the ${quake.magnitudeType} scale, calibrated for Greece. A global agency reporting a moment magnitude for the same event will differ, often by several tenths.`,
      );
    }

    return { ...quake, notes };
  },
});

export const listRecentEarthquakesTool = defineTool({
  name: "list_recent_earthquakes",
  title: "What has shaken lately",
  description:
    "The earthquakes the National Observatory of Athens has located in the last day, newest first, with no arguments needed. " +
    "This is the quick answer to whether something has just happened and how big it was. Greece records dozens of events a day, almost all of them too small to feel, so give minMagnitude around 3 to see only what people noticed. " +
    `For anything beyond the last ${MAX_RECENT_HOURS} hours, or for a region, a depth or a particular period, use search_earthquakes.`,
  inputSchema: {
    hours: z
      .number()
      .min(1)
      .max(MAX_RECENT_HOURS)
      .optional()
      .describe(`How far back to look, 1-${MAX_RECENT_HOURS} hours. Defaults to ${DEFAULT_RECENT_HOURS}.`),
    minMagnitude: magnitude("smallest"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_RECENT)
      .optional()
      .describe(`Most events to return, 1-${MAX_RECENT}. Defaults to ${DEFAULT_RECENT}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {},
  async handler(input, context) {
    const hours = input.hours ?? DEFAULT_RECENT_HOURS;
    const limit = input.limit ?? DEFAULT_RECENT;
    const window = resolveWindow(undefined, undefined, hours / 24);

    const result = await searchQuakes(
      { window, minMagnitude: input.minMagnitude, orderBy: "time", limit },
      context.cache,
      context.ttl,
      context.signal,
    );

    const largest = result.quakes.reduce<Quake | null>(
      (biggest, quake) =>
        quake.magnitude !== null && (biggest?.magnitude ?? -Infinity) < quake.magnitude ? quake : biggest,
      null,
    );

    return {
      hours,
      since: window.start.toISOString(),
      count: result.quakes.length,
      truncated: result.truncated,
      // Named separately because it is the question behind the question, and
      // the newest-first order buries it whenever the largest was not the last.
      largest:
        largest === null
          ? null
          : { id: largest.id, magnitude: largest.magnitude, region: largest.region, time: largest.time },
      earthquakes: result.quakes,
      notes: notesFor(window, result, limit, "time"),
    };
  },
});

export const tools = [searchEarthquakesTool, getEarthquakeTool, listRecentEarthquakesTool];
