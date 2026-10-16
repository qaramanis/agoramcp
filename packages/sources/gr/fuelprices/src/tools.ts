import { defineTool, InvalidInputError, NotFoundError, type Cache } from "@agoramcp/core";
import { z } from "zod";
import {
  fetchDaily,
  fetchListing,
  fetchWeekly,
  FUEL_NAMES,
  FUELS,
  type Bulletin,
  type BulletinType,
  type DailyBulletin,
  type Fuel,
  type Prices,
} from "./client.ts";
import { resolvePrefecture, type Prefecture } from "./prefectures.ts";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function readDay(value: string, field: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!DAY.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidInputError(`${field} "${value}" is not a date. Use YYYY-MM-DD, e.g. 2026-10-14.`);
  }
  return value;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** How far back a requested day may be answered by an earlier bulletin. */
const FALLBACK_DAYS = 7;

/**
 * The bulletin for a day: that day's, or else the last one before it within
 * a week — weekends of early 2017 and a few dozen days since have none.
 * No date means the latest.
 */
async function pick(
  type: BulletinType,
  date: string | undefined,
  cache: Cache,
  signal: AbortSignal,
): Promise<{ bulletin: Bulletin; note: string | null }> {
  const listing = await fetchListing(type, cache, signal);
  const latest = listing[0] as Bulletin;
  if (date === undefined) return { bulletin: latest, note: null };

  const wanted = readDay(date, "date");
  const found = listing.find((bulletin) => bulletin.date <= wanted);
  if (!found || found.date < addDays(wanted, -FALLBACK_DAYS)) {
    const oldest = listing.at(-1)?.date;
    throw new NotFoundError(
      wanted > latest.date
        ? `There is no bulletin for ${wanted} yet. The latest is for ${latest.date}; each day's is published around 12:30 the day after.`
        : `There is no bulletin for ${wanted} or the week before it. ${type === "weekly" ? "Weekly" : "Daily"} bulletins begin on ${oldest}.`,
    );
  }
  return {
    bulletin: found,
    note: found.date === wanted ? null : `No bulletin was published for ${wanted}; this is the one for ${found.date}, the last before it.`,
  };
}

function only(prices: Prices, fuel: Fuel | undefined): Prices {
  if (fuel === undefined) return prices;
  return { [fuel]: prices[fuel] ?? null };
}

function describePrefecture(prefecture: Prefecture) {
  return { name: prefecture.name, nameLatin: prefecture.latin };
}

const fuelSchema = z
  .enum(FUELS)
  .describe(
    "unleaded95, unleaded100, diesel (motor), autogas (LPG), heating_oil (published 15 October to 30 April only) or super (until 2022).",
  );

const prefectureSchema = z
  .string()
  .trim()
  .min(2)
  .max(600)
  .describe(
    "A prefecture, or several comma-separated, in Greek or Greeklish, by name or by its main town or island: \"Αττική\", \"Thessaloniki, Heraklion\", \"Santorini\" (Kyklades). Attica is reported as one.",
  );

function prefectureList(given: string | undefined): Prefecture[] | undefined {
  if (given === undefined) return undefined;
  return [...new Set(given.split(",").map((name) => name.trim()).filter(Boolean).map(resolvePrefecture))];
}

const UNIT = "€ per litre, VAT included";

/* -------------------------------------------------------------------------- */
/* list_bulletins                                                             */
/* -------------------------------------------------------------------------- */

const DEFAULT_LISTED = 31;
const MAX_LISTED = 400;

export const listBulletinsTool = defineTool({
  name: "list_bulletins",
  title: "Which fuel price bulletins exist",
  description:
    "The bulletins the observatory has published, newest first, with the date each is for and its PDF. " +
    "daily (the default) is the price per prefecture, every day since 14 March 2017; daily_national the national averages with station counts, from the same day; weekly, each Friday since 27 April 2012, the national picture with how the price is made up. " +
    "Each day's bulletin is for the day before and appears around 12:30 Athens time. A few dozen days have none — weekends in early 2017, and gaps in 2019, 2022, 2023 and 2024 — and asking for one of them is answered with the last bulletin before it.",
  inputSchema: {
    type: z.enum(["daily", "daily_national", "weekly"]).optional().describe("Which series. Defaults to daily."),
    year: z.number().int().min(2012).max(2100).optional().describe("Only this year."),
    month: z.number().int().min(1).max(12).optional().describe("Only this month, with year."),
    limit: z.number().int().min(1).max(MAX_LISTED).optional().describe(`Most bulletins, 1-${MAX_LISTED}. Defaults to ${DEFAULT_LISTED}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {},
  async handler(input, context) {
    if (input.month !== undefined && input.year === undefined) {
      throw new InvalidInputError("A month needs its year.");
    }
    const type: BulletinType = input.type ?? "daily";
    const listing = await fetchListing(type, context.cache, context.signal);
    const prefix =
      input.year === undefined ? "" : input.month === undefined ? `${input.year}-` : `${input.year}-${String(input.month).padStart(2, "0")}-`;
    const matching = listing.filter((bulletin) => bulletin.date.startsWith(prefix));
    const limit = input.limit ?? DEFAULT_LISTED;
    return {
      type,
      first: listing.at(-1)?.date ?? null,
      latest: listing[0]?.date ?? null,
      count: matching.length,
      truncated: matching.length > limit,
      bulletins: matching.slice(0, limit),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_prices                                                                 */
/* -------------------------------------------------------------------------- */

export const getPricesTool = defineTool({
  name: "get_prices",
  title: "Fuel prices by prefecture",
  description:
    "The average pump price of each fuel in each prefecture, and the national average weighted by sales, for one day, from the observatory's daily bulletin. " +
    `Prices are in ${UNIT}, averaged over what the stations of the prefecture declared that day. ` +
    "With no date, the latest bulletin, which is for yesterday or the day before; with a date that has no bulletin, the last one before it, and a note. " +
    "Name prefectures in Greek or Greeklish, by name or by a town or island in them; with none, all 51. Attica is one row. " +
    "Which fuels appear depends on the date: heating oil only from 15 October to 30 April, Super only until 2022. " +
    "For a run of days use get_price_history; for how the price splits into taxes and margins, get_price_breakdown.",
  inputSchema: {
    date: z.string().trim().optional().describe("The day, YYYY-MM-DD, from 2017-03-14. Defaults to the latest bulletin."),
    prefecture: prefectureSchema.optional(),
    fuel: fuelSchema.optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { prefecture: "Thessaloniki" },
  async handler(input, context) {
    const { bulletin, note } = await pick("daily", input.date, context.cache, context.signal);
    const daily = await fetchDaily(bulletin, context.cache, context.signal);
    const wanted = prefectureList(input.prefecture);

    const notes: string[] = [];
    if (note) notes.push(note);
    if (input.fuel !== undefined && !daily.fuels.includes(input.fuel)) {
      notes.push(
        `The bulletin for ${daily.date} has no ${FUEL_NAMES[input.fuel]} column${input.fuel === "heating_oil" ? ": heating oil is only reported from 15 October to 30 April" : ""}.`,
      );
    }

    const rows = daily.prefectures.filter((row) => wanted === undefined || wanted.includes(row.prefecture));
    return {
      date: daily.date,
      unit: UNIT,
      fuels: daily.fuels.map((fuel) => ({ fuel, name: FUEL_NAMES[fuel] })),
      national: only(daily.national, input.fuel),
      prefectures: rows.map((row) => ({ ...describePrefecture(row.prefecture), prices: only(row.prices, input.fuel) })),
      bulletinUrl: daily.url,
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_price_history                                                          */
/* -------------------------------------------------------------------------- */

const MAX_HISTORY_DAYS = 31;
const DEFAULT_HISTORY_DAYS = 14;

/** At most `limit` of `fn` in flight, results in input order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await fn(items[index] as T);
      }
    }),
  );
  return results;
}

export const getPriceHistoryTool = defineTool({
  name: "get_price_history",
  title: "Fuel prices day by day",
  description:
    "One fuel's daily average price over a run of days, for one prefecture or for the country, from the daily bulletins — to see whether prices are rising, by how much, and how one prefecture compares with the national average. " +
    `Up to ${MAX_HISTORY_DAYS} days at a time; with no dates, the last ${DEFAULT_HISTORY_DAYS} bulletins. Days with no bulletin are listed as missing rather than filled in. ` +
    `Prices are in ${UNIT}. Each day costs one bulletin, read once and kept, so a long run is slower the first time.`,
  inputSchema: {
    fuel: fuelSchema.optional().describe("Defaults to unleaded95."),
    prefecture: z.string().trim().min(2).max(60).optional().describe("One prefecture, as in get_prices. Without it, the national weighted average."),
    startDate: z.string().trim().optional().describe(`First day, YYYY-MM-DD. Defaults to ${DEFAULT_HISTORY_DAYS - 1} days before endDate.`),
    endDate: z.string().trim().optional().describe("Last day, YYYY-MM-DD. Defaults to the latest bulletin."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { prefecture: "Kyklades", fuel: "unleaded95", startDate: "2026-10-08", endDate: "2026-10-14" },
  async handler(input, context) {
    const fuel: Fuel = input.fuel ?? "unleaded95";
    const prefecture = input.prefecture === undefined ? undefined : resolvePrefecture(input.prefecture);
    const listing = await fetchListing("daily", context.cache, context.signal);

    const end = input.endDate === undefined ? (listing[0] as Bulletin).date : readDay(input.endDate, "endDate");
    const start = input.startDate === undefined ? addDays(end, -(DEFAULT_HISTORY_DAYS - 1)) : readDay(input.startDate, "startDate");
    if (start > end) throw new InvalidInputError("startDate is after endDate.");
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
    if (days > MAX_HISTORY_DAYS) {
      throw new InvalidInputError(`That is ${days} days; the most in one call is ${MAX_HISTORY_DAYS}. Ask month by month.`);
    }

    const inRange = listing.filter((bulletin) => bulletin.date >= start && bulletin.date <= end).reverse();
    const read = await mapLimited(inRange, 3, async (bulletin) => {
      try {
        return { bulletin, daily: await fetchDaily(bulletin, context.cache, context.signal), error: null };
      } catch (error) {
        return { bulletin, daily: null as DailyBulletin | null, error: error instanceof Error ? error.message : String(error) };
      }
    });

    const have = new Set(inRange.map((bulletin) => bulletin.date));
    const missing: string[] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (!have.has(day)) missing.push(day);
    }

    const series = read.map(({ bulletin, daily, error }) => {
      if (!daily) return { date: bulletin.date, price: null, error };
      const prices = prefecture === undefined ? daily.national : daily.prefectures.find((row) => row.prefecture === prefecture)?.prices;
      return { date: bulletin.date, price: prices?.[fuel] ?? null };
    });

    const priced = series.filter((point): point is { date: string; price: number } => typeof point.price === "number");
    const first = priced[0];
    const last = priced.at(-1);
    const notes: string[] = [];
    if (missing.length > 0) notes.push(`No bulletin was published for ${missing.length} of these days; they are listed in missing.`);
    if (priced.length === 0 && series.length > 0) {
      notes.push(`None of these bulletins has a ${FUEL_NAMES[fuel]} price${fuel === "heating_oil" ? ": heating oil is only reported from 15 October to 30 April" : ""}.`);
    }

    return {
      fuel,
      fuelName: FUEL_NAMES[fuel],
      area: prefecture === undefined ? "Greece, weighted national average" : prefecture.name,
      unit: UNIT,
      startDate: start,
      endDate: end,
      // Two published figures side by side, not a computed statistic: the
      // change is the caller's to state, as derived.
      first: first ?? null,
      last: last ?? null,
      series,
      missing,
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_price_breakdown                                                        */
/* -------------------------------------------------------------------------- */

export const getPriceBreakdownTool = defineTool({
  name: "get_price_breakdown",
  title: "What a litre of fuel is made of",
  description:
    "How the national average pump price of unleaded 95, motor diesel and, in winter, heating oil splits into the refinery price, taxes and levies, and the retail margin, in € per litre and as shares of the price — from the observatory's weekly bulletin, which is for a Friday (the refinery price is Thursday's). " +
    "With no date, the latest week; with a date, the last weekly bulletin on or before it. " +
    "The figures are read from the bulletin's own sentences: one it does not state comes back null, and `consistent` says whether the parts add up to the price, as they do in every bulletin checked.",
  inputSchema: {
    date: z.string().trim().optional().describe("A day, YYYY-MM-DD; the week whose Friday is on or before it. From 2012-04-27."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {},
  async handler(input, context) {
    const { bulletin, note } = await pick("weekly", input.date, context.cache, context.signal);
    const weekly = await fetchWeekly(bulletin, context.cache, context.signal);

    const notes: string[] = [];
    if (note) notes.push(note);
    if (weekly.breakdowns.length === 0) {
      notes.push("This bulletin's sections could not be read; the PDF itself is at bulletinUrl.");
    } else if (weekly.breakdowns.some((breakdown) => !breakdown.consistent)) {
      notes.push("For at least one fuel the parts do not add up to the price, or one of them was not found: check that fuel against the PDF.");
    }

    return {
      week: weekly.date,
      unit: "€ per litre",
      fuels: weekly.breakdowns.map((breakdown) => ({ ...breakdown, name: FUEL_NAMES[breakdown.fuel] })),
      bulletinUrl: weekly.url,
      notes,
    };
  },
});

export const tools = [listBulletinsTool, getPricesTool, getPriceHistoryTool, getPriceBreakdownTool];
