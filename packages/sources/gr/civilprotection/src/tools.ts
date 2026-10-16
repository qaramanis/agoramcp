import { defineTool, InvalidInputError, NotFoundError, type Cache, type ToolContext } from "@agoramcp/core";
import { z } from "zod";
import { AREAS, type FireRiskArea } from "./areas.ts";
import { CATEGORIES, inFrame, latestMaps, mapFor, readMap, readPoint, type FireRiskMap } from "./client.ts";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function readDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!DAY.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidInputError(`date "${value}" is not a date. Use YYYY-MM-DD, e.g. 2026-08-13.`);
  }
  return value;
}

function athensToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The circular sets the season: maps are issued from 1 May to 31 October. */
function inSeason(date: string): boolean {
  const month = Number(date.slice(5, 7));
  return month >= 5 && month <= 10;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("ς", "σ").trim();
}

/** "today", "tomorrow", or the date, as an answer should put it. */
function relative(date: string): string {
  const today = athensToday();
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  if (date === addDays(today, -1)) return "yesterday";
  return date;
}

/** A published map never changes; one valid for today or later is held an hour, in case of a reissue. */
function mapTtl(date: string): number {
  return date < athensToday() ? 7 * 86_400 : 3_600;
}

type Resolved = { map: FireRiskMap; notes: string[] } | { map: null; notes: string[] };

/**
 * The map to answer from: the one for `date`, or with no date the newest —
 * which from about 12:30 Athens time is tomorrow's. Outside the season no
 * map is issued, and that is an answer, not a missing record.
 */
async function resolveMap(date: string | undefined, cache: Cache, signal: AbortSignal): Promise<Resolved> {
  if (date === undefined) {
    const [map] = await latestMaps(1, cache, signal);
    const notes: string[] = [];
    if (map && map.date < athensToday()) {
      notes.push(
        inSeason(athensToday())
          ? `The newest map is for ${map.date}; today's has not been published.`
          : `No map is issued outside the fire season (1 May to 31 October). This is the season's last, for ${map.date}.`,
      );
    }
    if (!map) throw new NotFoundError("The archive lists no fire-risk maps.");
    return { map, notes };
  }

  const wanted = readDay(date);
  if (!inSeason(wanted)) {
    return { map: null, notes: [`No fire-risk map is issued for ${wanted}: maps are issued only in the fire season, 1 May to 31 October.`] };
  }
  const map = await mapFor(wanted, cache, signal);
  if (!map) {
    if (wanted > athensToday()) {
      throw new NotFoundError(`The map for ${wanted} is not published yet. Each day's map is issued around 12:30 the day before.`);
    }
    throw new NotFoundError(`The archive has no fire-risk map for ${wanted}.`);
  }
  return { map, notes: [] };
}

function describeArea(area: FireRiskArea) {
  return {
    place: area.place,
    forestService: area.forestService,
    regionalUnits: area.regionalUnits,
    region: area.region,
  };
}

function describeCategory(category: number | null) {
  if (category === null) return { category: null, label: null, labelEl: null };
  const entry = CATEGORIES[category];
  return { category, label: entry?.label ?? null, labelEl: entry?.labelEl ?? null };
}

/** Areas by place, forest service, regional unit, region or municipality, in Greek or Latin script. */
function findAreas(query: string): FireRiskArea[] {
  const wanted = fold(query).replace(/^(δ\.?υ\.?|δασικη υπηρεσια)\s*/u, "");
  if (wanted === "") return [];
  return AREAS.filter((area) => {
    const names = [
      ...area.place.split(","),
      (area.forestService ?? "").replace(/^Δ\.Υ\.\s*/u, ""),
      ...area.regionalUnits,
      area.region,
      ...area.municipalities,
    ].map(fold);
    return names.some((name) => name === wanted || name.startsWith(wanted) || (wanted.length >= 4 && name.includes(wanted)));
  });
}

/** The areas at the day's highest category — all 148 on a quiet day, so a long list is cut. */
function atHighest(places: string[]): { areas: string[]; more?: number } {
  return places.length > 30 ? { areas: places.slice(0, 30), more: places.length - 30 } : { areas: places };
}

const SEASON_NOTE =
  "The categories are read from the map image itself; the map is the official statement and is linked in mapUrl. Category 4 and 5 days also bring a civil protection press release naming the areas.";

/* -------------------------------------------------------------------------- */
/* list_maps                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAPS = 14;
const MAX_MAPS = 40;

export const listMapsTool = defineTool({
  name: "list_maps",
  title: "Which fire-risk maps exist",
  description:
    "The most recent daily fire-risk maps, newest first, each with the day it is valid for and its image. " +
    "A map is issued every day of the fire season, 1 May to 31 October, around 12:30 for the next day; outside the season the newest is the last of the past season. " +
    "get_fire_risk reads one into categories by area; get_fire_risk_at reads one at a place.",
  inputSchema: {
    limit: z.number().int().min(1).max(MAX_MAPS).optional().describe(`How many maps, 1-${MAX_MAPS}. Defaults to ${DEFAULT_MAPS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {},
  async handler(input, context) {
    const maps = await latestMaps(input.limit ?? DEFAULT_MAPS, context.cache, context.signal);
    return {
      today: athensToday(),
      inSeason: inSeason(athensToday()),
      latest: maps[0]?.date ?? null,
      count: maps.length,
      maps: maps.map((map) => ({ date: map.date, validFor: relative(map.date), mapUrl: map.url })),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_fire_risk                                                              */
/* -------------------------------------------------------------------------- */

export const getFireRiskTool = defineTool({
  name: "get_fire_risk",
  title: "Fire risk by area",
  description:
    "The wildfire risk forecast for one day, by area: each of the 148 areas the official map divides Greece into, with its category — 1 low, 2 medium, 3 high, 4 very high, 5 state of alert — the highest category of the day and the areas at it, and how many areas are at each. " +
    "Areas are the forest-service districts the map is drawn on, named by their main towns or islands, with their regional unit and region. " +
    "With no date, the newest map, which from about 12:30 Athens time is tomorrow's. Maps are issued only from 1 May to 31 October; a date outside that is answered with issued: false. Maps before the 2023 season are on an older template and are not read. " +
    "Filter with minCategory (e.g. 4 for the areas to worry about) or region. When the map carries the lightning advisory — forests struck by lightning carry a raised risk — lightningAdvisory is true.",
  inputSchema: {
    date: z.string().trim().optional().describe("The day the forecast is for, YYYY-MM-DD. Defaults to the newest map."),
    minCategory: z.number().int().min(1).max(5).optional().describe("Only areas at this category or higher."),
    region: z.string().trim().min(2).max(60).optional().describe("Only areas in this region or regional unit, e.g. \"Αττικής\", \"Κρήτης\", \"Ηρακλείου\"."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { date: "2026-08-13", minCategory: 4 },
  async handler(input, context) {
    const resolved = await resolveMap(input.date, context.cache, context.signal);
    if (!resolved.map) return { date: input.date ?? null, issued: false, notes: resolved.notes };

    const read = await readMap(resolved.map, mapTtl(resolved.map.date), context.cache, context.signal);
    const counts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const entry of read.areas) if (entry.category !== null) counts[String(entry.category)] = (counts[String(entry.category)] ?? 0) + 1;
    const highest = Math.max(0, ...read.areas.map((entry) => entry.category ?? 0));

    const regionFold = input.region === undefined ? undefined : fold(input.region);
    const listed = read.areas
      .filter((entry) => input.minCategory === undefined || (entry.category ?? 0) >= input.minCategory)
      .filter(
        (entry) =>
          regionFold === undefined ||
          fold(entry.area.region).includes(regionFold) ||
          entry.area.regionalUnits.some((unit) => fold(unit).includes(regionFold)),
      )
      .sort((a, b) => (b.category ?? 0) - (a.category ?? 0) || a.area.region.localeCompare(b.area.region, "el"));

    if (regionFold !== undefined && listed.length === 0 && input.minCategory === undefined) {
      throw new InvalidInputError(`No area is in a region or regional unit matching "${input.region}". Regions are named in the genitive: Αττικής, Κρήτης, Νοτίου Αιγαίου.`);
    }

    const notes = [...resolved.notes];
    const unread = read.areas.filter((entry) => entry.category === null);
    if (unread.length > 0) notes.push(`${unread.map((entry) => entry.area.place).join(", ")} could not be read from this map.`);
    notes.push(SEASON_NOTE);

    return {
      date: read.date,
      validFor: relative(read.date),
      issued: true,
      highest: { ...describeCategory(highest || null), ...atHighest(read.areas.filter((entry) => entry.category === highest).map((entry) => entry.area.place)) },
      counts,
      lightningAdvisory: read.lightningAdvisory,
      areas: listed.map((entry) => ({ ...describeArea(entry.area), ...describeCategory(entry.category) })),
      mapUrl: read.url,
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_fire_risk_at                                                           */
/* -------------------------------------------------------------------------- */

async function atPlace(input: { place: string }, map: FireRiskMap, context: ToolContext) {
  const areas = findAreas(input.place);
  if (areas.length === 0) {
    throw new NotFoundError(
      `No area matches "${input.place}". Name a town, island, regional unit or municipality — "Μαραθώνας", "Rhodes", "Χανίων" — or give latitude and longitude.`,
    );
  }
  const read = await readMap(map, mapTtl(map.date), context.cache, context.signal);
  return areas.slice(0, 10).map((area) => {
    const entry = read.areas.find((candidate) => candidate.area === area);
    return { ...describeArea(area), ...describeCategory(entry?.category ?? null) };
  });
}

export const getFireRiskAtTool = defineTool({
  name: "get_fire_risk_at",
  title: "Fire risk at a place",
  description:
    "The wildfire risk category at one place on one day, read from the official map: by latitude and longitude, or by the name of a town, island, municipality or regional unit, in Greek or Latin script. " +
    "A point is placed on the map by its projection, to within a pixel (about 700 m); the area it falls in is found from the map's own borders. A point at sea, or on a border or coastline with no area within 3 pixels, has no category. " +
    "With no date, the newest map, which from about 12:30 Athens time is tomorrow's. Maps exist only from 1 May to 31 October.",
  inputSchema: {
    latitude: z.number().min(34).max(42.5).optional().describe("Latitude in degrees, with longitude."),
    longitude: z.number().min(19).max(30).optional().describe("Longitude in degrees, with latitude."),
    place: z.string().trim().min(2).max(80).optional().describe("A place instead of a point: \"Μαραθώνας\", \"Santorini\", \"Ηρακλείου\"."),
    date: z.string().trim().optional().describe("The day the forecast is for, YYYY-MM-DD. Defaults to the newest map."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { latitude: 37.9755, longitude: 23.7348, date: "2026-08-13" },
  async handler(input, context) {
    const hasPoint = input.latitude !== undefined || input.longitude !== undefined;
    if (hasPoint && input.place !== undefined) throw new InvalidInputError("Give latitude and longitude, or place, not both.");
    if (!hasPoint && input.place === undefined) throw new InvalidInputError("Give latitude and longitude, or a place.");
    if (hasPoint && (input.latitude === undefined || input.longitude === undefined)) {
      throw new InvalidInputError("A point needs both latitude and longitude.");
    }

    const resolved = await resolveMap(input.date, context.cache, context.signal);
    if (!resolved.map) return { date: input.date ?? null, issued: false, notes: resolved.notes };
    const map = resolved.map;

    if (input.place !== undefined) {
      return {
        date: map.date,
        validFor: relative(map.date),
        issued: true,
        areas: await atPlace({ place: input.place }, map, context),
        mapUrl: map.url,
        notes: [...resolved.notes, SEASON_NOTE],
      };
    }

    const latitude = input.latitude as number;
    const longitude = input.longitude as number;
    if (!inFrame(latitude, longitude)) {
      throw new InvalidInputError("That point is outside the map, which covers Greece from 34.7° to 41.8° north and 19.3° to 29.7° east.");
    }
    const point = await readPoint(map, latitude, longitude, context.cache, context.signal);
    if (!point) {
      return {
        date: map.date,
        validFor: relative(map.date),
        issued: true,
        latitude,
        longitude,
        ...describeCategory(null),
        area: null,
        mapUrl: map.url,
        notes: [...resolved.notes, "That point is at sea, or on a line of the map with no area within 3 pixels (about 2 km): the map gives it no category."],
      };
    }

    return {
      date: map.date,
      validFor: relative(map.date),
      issued: true,
      latitude,
      longitude,
      ...describeCategory(point.category),
      area: point.area ? describeArea(point.area) : null,
      mapUrl: map.url,
      notes: [
        ...resolved.notes,
        ...(point.offsetPx > 0 ? [`The point fell on a border or coastline; the category is from the nearest area, ${point.offsetPx} pixel(s) (about ${Math.round(point.offsetPx * 0.69 * 10) / 10} km) away.`] : []),
        SEASON_NOTE,
      ],
    };
  },
});

export const tools = [listMapsTool, getFireRiskTool, getFireRiskAtTool];
