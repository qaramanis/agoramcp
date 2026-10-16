import { defineTool, InvalidInputError, NotFoundError, type Cache } from "@agoramcp/core";
import { z } from "zod";
import {
  attributeText,
  checkPeriods,
  fetchData,
  fetchDataflows,
  fetchStructure,
  isoDate,
  isStale,
  normalizeFlow,
  normalizeKey,
  thirdPartyNote,
  type Series,
} from "./client.ts";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Lowercase, accents off, so "Euro area" finds "euro area" and "Zone euro" finds nothing it should not. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function words(text: string | undefined): string[] {
  return text === undefined ? [] : fold(text).split(/\s+/u).filter((word) => word !== "");
}

function matchesAll(haystack: string, needles: readonly string[]): boolean {
  const folded = fold(haystack);
  return needles.every((needle) => folded.includes(needle));
}

/** At most `limit` of `fn` in flight, results in input order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function readDay(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (!DAY.test(value) || Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new InvalidInputError(`${field} "${value}" is not a date. Use YYYY-MM-DD, e.g. 2026-10-14.`);
  }
  return date;
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A series as an answer carries it: what it is, in what unit, and from whom. */
function describeSeries(series: Series) {
  const decimals = Number(series.attributes.DECIMALS?.code);
  return {
    key: series.key,
    title: attributeText(series, "TITLE"),
    titleComplement: attributeText(series, "TITLE_COMPL"),
    unit: attributeText(series, "UNIT"),
    unitMultiplier: series.attributes.UNIT_MULT?.name ?? null,
    decimals: Number.isInteger(decimals) ? decimals : null,
    source: attributeText(series, "SOURCE_AGENCY") ?? attributeText(series, "COMPILING_ORG"),
    dimensions: series.dimensions,
  };
}

/**
 * Flows that still answer but stopped long ago, and where their successor
 * is. Asked naively, each returns a confident figure years out of date.
 */
const SUPERSEDED: Record<string, string> = {
  ICP: "ICP stopped at December 2025. Inflation is in the HICP flow now, with the series suffix 4D0 (HICP/M.GR.N.000000.4D0.ANR).",
  GST: "GST is the ESA 95 government statistics and ends in 2013-2014. Government debt and deficit are in GFS.",
  ST1: "ST1, the national balance-of-payments flow, ends in 2014.",
};

/** Agencies whose flows the ECB republishes rather than compiles. */
const COMPILED_ELSEWHERE: Record<string, string> = {
  ESTAT: "Compiled by Eurostat and republished by the ECB.",
  EUROSTAT: "Compiled by Eurostat and republished by the ECB.",
  IMF: "Compiled by the IMF and republished by the ECB. The ECB's free-reuse policy does not cover third-party data.",
};

const REUSE_NOTE =
  "Values are exactly as the ECB publishes them. Its reuse terms ask that the source be quoted and that any value you derive (a growth rate, an inverse rate, an average) be said to be derived.";

/* -------------------------------------------------------------------------- */
/* get_exchange_rate                                                          */
/* -------------------------------------------------------------------------- */

const MAX_RATE_DAYS = 366;
const DEFAULT_RATE_DAYS = 30;
/** Christmas to New Year is the longest run without a reference rate. */
const LOOKBACK_DAYS = 10;

export const getExchangeRateTool = defineTool({
  name: "get_exchange_rate",
  title: "Euro reference exchange rates",
  description:
    "The ECB's euro reference exchange rate for one or more currencies: how many units of each currency one euro buys, as the ECB sets it around 16:00 CET each TARGET working day. " +
    "With no dates, the latest rate. With `date`, the rate in force that day — the last one set on or before it, since none is set at weekends or on TARGET holidays. " +
    `With startDate and/or endDate, every daily rate in that window, up to ${MAX_RATE_DAYS} days. ` +
    "About thirty currencies are set daily (USD, GBP, JPY, CHF, TRY, CNY, AUD, CAD, PLN, RON, SEK…). Currencies that joined the euro keep their final rate: GRD, the drachma, stops at 29 December 2000 at the irrevocable 340.75. " +
    "These are reference rates for information, not the rate a bank will trade at.",
  inputSchema: {
    currencies: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .optional()
      .describe("ISO 4217 codes, comma-separated: \"USD\" or \"USD,GBP,TRY\", up to 10. Defaults to USD. The euro is the base and cannot be one of them."),
    date: z.string().trim().optional().describe("One day, YYYY-MM-DD: the rate in force that day. Not with startDate/endDate."),
    startDate: z.string().trim().optional().describe(`First day of a window, YYYY-MM-DD. Defaults to ${DEFAULT_RATE_DAYS} days before endDate when only endDate is given.`),
    endDate: z.string().trim().optional().describe("Last day of a window, YYYY-MM-DD. Defaults to today when only startDate is given."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { currencies: "USD" },
  async handler(input, context) {
    const codes = [...new Set((input.currencies ?? "USD").split(/[\s,;]+/u).filter(Boolean).map((code) => code.toUpperCase()))];
    if (codes.length > 10) throw new InvalidInputError("At most 10 currencies in one call.");
    for (const code of codes) {
      if (!/^[A-Z]{3}$/u.test(code)) throw new InvalidInputError(`"${code}" is not an ISO 4217 currency code.`);
      if (code === "EUR") throw new InvalidInputError("The euro is the base of every reference rate; ask for the other currency.");
    }

    const ranged = input.startDate !== undefined || input.endDate !== undefined;
    if (input.date !== undefined && ranged) {
      throw new InvalidInputError("Give date for one day, or startDate/endDate for a window, not both.");
    }

    const today = todayUtc();
    let window: { start: Date; end: Date; last?: number };
    if (input.date !== undefined) {
      const day = readDay(input.date, "date");
      if (day > today) throw new InvalidInputError("date is in the future; no rate has been set for it.");
      window = { start: addDays(day, -LOOKBACK_DAYS), end: day, last: 1 };
    } else if (ranged) {
      const end = input.endDate === undefined ? today : readDay(input.endDate, "endDate");
      const start = input.startDate === undefined ? addDays(end, -DEFAULT_RATE_DAYS) : readDay(input.startDate, "startDate");
      if (start > end) throw new InvalidInputError("startDate is after endDate.");
      if (start > today) throw new InvalidInputError("startDate is in the future; no rate has been set for it.");
      const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (days > MAX_RATE_DAYS) {
        throw new InvalidInputError(`That window is ${days} days; the most in one call is ${MAX_RATE_DAYS}. Ask year by year.`);
      }
      window = { start, end };
    } else {
      window = { start: today, end: today, last: 1 };
    }

    const latest = input.date === undefined && !ranged;
    // A window closed more than a week ago will not change.
    const ttl = !latest && window.end < addDays(today, -7) ? 86_400 : context.ttl;

    let series: Series[];
    try {
      series = await fetchData(
        {
          flow: "EXR",
          key: `D.${codes.join("+")}.EUR.SP00.A`,
          ...(latest ? {} : { startPeriod: isoDate(window.start), endPeriod: isoDate(window.end) }),
          lastObservations: window.last,
        },
        context.cache,
        ttl,
        context.signal,
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundError(
          `The ECB sets no euro reference rate for ${codes.join(", ")}. It sets about thirty currencies daily; one that joined the euro keeps its final rate under its own code (GRD, CYP, BGN).`,
        );
      }
      throw error;
    }

    const notes: string[] = [];
    const reference = input.date === undefined ? today : readDay(input.date, "date");
    const rates = [];
    const history = [];
    const missing: string[] = [];

    for (const code of codes) {
      const found = series.find((entry) => entry.dimensions.CURRENCY?.code === code);
      const last = found?.observations.at(-1);
      if (!found || !last) {
        missing.push(code);
        continue;
      }
      const name = found.dimensions.CURRENCY?.name ?? code;
      rates.push({ currency: code, name, date: last.period, rate: last.value, ...(last.comment ? { comment: last.comment } : {}) });
      if (ranged) {
        history.push({
          currency: code,
          name,
          observations: found.observations.map((observation) => ({ date: observation.period, rate: observation.value })),
        });
      }
      if (!ranged && reference.getTime() - Date.parse(`${last.period}T00:00:00Z`) > 14 * 86_400_000) {
        notes.push(`No reference rate has been set for ${code} since ${last.period}: the ECB discontinued it, and this is its final rate.`);
      } else if (input.date !== undefined && last.period !== input.date) {
        notes.push(`No rate was set for ${code} on ${input.date} (a weekend or TARGET holiday, or not yet published); this is the one in force, set on ${last.period}.`);
      }
    }

    if (missing.length > 0) {
      notes.push(
        latest
          ? `The ECB sets no reference rate for ${missing.join(", ")}.`
          : `No reference rate for ${missing.join(", ")} in that window. The ECB may not set one, or may have stopped before it.`,
      );
    }
    notes.push(REUSE_NOTE);

    return {
      base: "EUR",
      meaning: "Units of each currency that one euro buys.",
      rates,
      ...(ranged ? { window: { start: isoDate(window.start), end: isoDate(window.end) }, history } : {}),
      missing,
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* list_greek_indicators                                                      */
/* -------------------------------------------------------------------------- */

interface Indicator {
  id: string;
  label: string;
  flow: string;
  key: string;
}

/**
 * The questions people ask the ECB about Greece, each pinned to the series
 * that answers it. Every key was checked live; the stale look-alikes (ICP,
 * GST, ST1) are deliberately absent.
 */
export const GREEK_INDICATORS: readonly Indicator[] = [
  { id: "bond_yield_10y", label: "10-year government bond yield (convergence criterion)", flow: "IRS", key: "M.GR.L.L40.CI.0000.EUR.N.Z" },
  { id: "inflation", label: "HICP inflation, annual rate", flow: "HICP", key: "M.GR.N.000000.4D0.ANR" },
  { id: "core_inflation", label: "HICP inflation excluding energy, food, alcohol and tobacco, annual rate", flow: "HICP", key: "M.GR.N.XEF000.4D0.ANR" },
  { id: "energy_inflation", label: "HICP energy, annual rate", flow: "HICP", key: "M.GR.N.NRGY00.4D0.ANR" },
  { id: "food_inflation", label: "HICP food including alcohol and tobacco, annual rate", flow: "HICP", key: "M.GR.N.FOOD00.4D0.ANR" },
  { id: "mortgage_rate", label: "Cost of borrowing for house purchase, new loans", flow: "MIR", key: "M.GR.B.A2C.AM.R.A.2250.EUR.N" },
  { id: "business_loan_rate", label: "Interest rate on new loans to non-financial corporations", flow: "MIR", key: "M.GR.B.A2A.A.R.A.2240.EUR.N" },
  { id: "household_term_deposit_rate", label: "Interest rate on new household deposits up to one year", flow: "MIR", key: "M.GR.B.L22.F.R.A.2250.EUR.N" },
  { id: "household_overnight_deposit_rate", label: "Interest rate on household overnight deposits", flow: "MIR", key: "M.GR.B.L21.A.R.A.2250.EUR.N" },
  { id: "household_deposits", label: "Deposits of households with Greek banks, outstanding", flow: "BSI", key: "M.GR.N.A.L20.A.1.U2.2250.Z01.E" },
  { id: "business_loans", label: "Loans to non-financial corporations by Greek banks, outstanding", flow: "BSI", key: "M.GR.N.A.A20.A.1.U2.2240.Z01.E" },
  { id: "household_loans", label: "Loans to households by Greek banks, outstanding", flow: "BSI", key: "M.GR.N.A.A20.A.1.U2.2250.Z01.E" },
  { id: "target_balance", label: "Bank of Greece TARGET balance", flow: "TGB", key: "M.GR.N.A094T.U2.EUR.E" },
  { id: "flat_prices", label: "Residential property prices, flats (Bank of Greece index)", flow: "RESR", key: "Q.GR._T.N.RTF.TVAL.GR2.TB.N.IX" },
  { id: "sovereign_stress", label: "Sovereign systemic stress indicator (SovCISS)", flow: "CISS", key: "D.GR.Z0Z.4F.EC.SOV_CIN.IDX" },
  { id: "npl_ratio", label: "Non-performing loans ratio of significant banks", flow: "SUP", key: "Q.GR.W0._Z.I7000._T.ALL._Z._Z._Z.PCT.C" },
  { id: "government_debt", label: "General government gross debt, % of GDP", flow: "GFS", key: "A.N.GR.W0.S13.S1.C.L.LE.GD.T._Z.XDC_R_B1GQ._T.F.V.N._T" },
  { id: "government_balance", label: "General government deficit (-) or surplus (+), % of GDP", flow: "GFS", key: "A.N.GR.W0.S13.S1._Z.B.B9._Z._Z._Z.XDC_R_B1GQ._Z.S.V.N._T" },
];

async function readIndicator(indicator: Indicator, cache: Cache, ttl: number, signal: AbortSignal) {
  try {
    const [series] = await fetchData({ flow: indicator.flow, key: indicator.key, lastObservations: 2 }, cache, ttl, signal);
    const latest = series?.observations.at(-1);
    const previous = series?.observations.at(-2);
    return {
      indicator: indicator.id,
      label: indicator.label,
      flow: indicator.flow,
      key: indicator.key,
      period: latest?.period ?? null,
      value: latest?.value ?? null,
      ...(latest?.status ? { status: latest.status.name ?? latest.status.code } : {}),
      previousPeriod: previous?.period ?? null,
      previousValue: previous?.value ?? null,
      unit: series ? attributeText(series, "UNIT") : null,
      unitMultiplier: series?.attributes.UNIT_MULT?.name ?? null,
      stale: series ? isStale(series) : null,
    };
  } catch (error) {
    // One series failing should not cost the other seventeen.
    return {
      indicator: indicator.id,
      label: indicator.label,
      flow: indicator.flow,
      key: indicator.key,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const listGreekIndicatorsTool = defineTool({
  name: "list_greek_indicators",
  title: "Greece at a glance, from the ECB",
  description:
    "The latest value, and the one before it, of eighteen ECB series on Greece in one call: the 10-year bond yield; headline, core, energy and food inflation; what Greek banks charge on new mortgages and business loans and pay on household deposits; household deposits and household and business loans outstanding; the Bank of Greece's TARGET balance; flat prices; the sovereign stress index; the banks' non-performing loans ratio; and government debt and deficit as a share of GDP. " +
    "Each row names its flow and key, so get_series can fetch its history. Rates are percentages; stocks are in the unit and multiplier the row gives (millions of euro, mostly). " +
    "Use it to answer \"how is Greece doing\" questions, or to find the key for one of these without searching.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {},
  async handler(_input, context) {
    const rows = await mapLimited(GREEK_INDICATORS, 4, (indicator) =>
      readIndicator(indicator, context.cache, context.ttl, context.signal),
    );
    const failed = rows.filter((row) => "error" in row).length;
    return {
      count: rows.length,
      indicators: rows,
      notes: [
        ...(failed > 0 ? [`${failed} of ${rows.length} series could not be read just now; each says why.`] : []),
        "Government debt and balance (GFS) are compiled by Eurostat and republished by the ECB.",
        REUSE_NOTE,
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* search_dataflows                                                           */
/* -------------------------------------------------------------------------- */

const DEFAULT_FLOWS = 50;
const MAX_FLOWS = 250;

export const searchDataflowsTool = defineTool({
  name: "search_dataflows",
  title: "Find an ECB dataflow",
  description:
    "Find the dataflow — the ECB's word for a dataset — that holds a statistic, by words in its id or name. Every series lives in one flow: EXR exchange rates, MIR bank interest rates, BSI bank balance sheets, HICP consumer prices, IRS long-term interest rates, GFS government finance, RESR property prices, SUP banking supervision, TGB TARGET balances, CISS stress indicators. " +
    "Names are English; some flows are named only by their id. With no words, every flow. " +
    "Next, find_series lists the series a flow holds for Greece, and get_series reads one. " +
    "Flows from Eurostat and the IMF are republished by the ECB and marked as such; a few old flows still answer but stopped years ago, and are marked with their successor.",
  inputSchema: {
    words: z.string().trim().max(200).optional().describe("Words to find in the flow's id or name, all of them, e.g. \"interest rate\", \"property\", \"balance sheet\"."),
    limit: z.number().int().min(1).max(MAX_FLOWS).optional().describe(`Most flows to return, 1-${MAX_FLOWS}. Defaults to ${DEFAULT_FLOWS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { words: "interest" },
  async handler(input, context) {
    const flows = await fetchDataflows(context.cache, context.signal);
    const needles = words(input.words);
    const limit = input.limit ?? DEFAULT_FLOWS;

    const matches = flows.filter((flow) => matchesAll(`${flow.id} ${flow.name}`, needles));
    return {
      total: matches.length,
      truncated: matches.length > limit,
      dataflows: matches.slice(0, limit).map((flow) => {
        const note = SUPERSEDED[flow.id] ?? COMPILED_ELSEWHERE[flow.agency];
        return { id: flow.id, agency: flow.agency, name: flow.name, ...(note ? { note } : {}) };
      }),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* find_series                                                                */
/* -------------------------------------------------------------------------- */

const DEFAULT_SERIES = 25;
const MAX_SERIES_LISTED = 100;
const MAX_CODES_PER_DIMENSION = 30;

export const findSeriesTool = defineTool({
  name: "find_series",
  title: "Find a series and its key",
  description:
    "List the series one dataflow holds, with each one's key, title and unit, filtered by words in the title — the step between search_dataflows and get_series. " +
    "By default only Greece's series (refArea GR) in flows that have a country dimension; give refArea for another country or euro-area aggregate (U2 is the euro area, I9 the euro area in its changing composition), or an empty string for every country. " +
    "Alongside the series comes each dimension of the key, in key order, with the codes present among the matches — which is how to build a key by hand, or narrow one with `key` (empty parts are wildcards, + joins codes). " +
    "The series lists are a day old at most.",
  inputSchema: {
    flow: z.string().trim().min(1).max(40).describe("The dataflow id, e.g. MIR, BSI, HICP. search_dataflows finds it."),
    words: z.string().trim().max(200).optional().describe("Words that must all appear in the series' title or its dimension labels, e.g. \"house purchase\", \"deposits households\"."),
    refArea: z.string().trim().max(4).optional().describe("Country or area code for flows that have REF_AREA. Defaults to GR (Greece); \"\" for every country."),
    key: z.string().trim().max(400).optional().describe("A partial key to narrow by, overriding refArea, e.g. M.GR.B.A2C..R.A.2250.EUR.N. One part per dimension, empty for any."),
    limit: z.number().int().min(1).max(MAX_SERIES_LISTED).optional().describe(`Most series to return, 1-${MAX_SERIES_LISTED}. Defaults to ${DEFAULT_SERIES}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { flow: "MIR", words: "house purchase" },
  async handler(input, context) {
    const flow = normalizeFlow(input.flow);
    const structure = await fetchStructure(flow, context.cache, context.signal);
    const notes: string[] = [];

    let key: string;
    if (input.key !== undefined && input.key !== "") {
      key = normalizeKey(input.key, structure.dimensions);
    } else {
      const area = (input.refArea ?? "GR").toUpperCase();
      const hasArea = structure.dimensions.some((dimension) => dimension.id === "REF_AREA");
      if (!hasArea && input.refArea !== undefined && input.refArea !== "") {
        notes.push(`${flow} has no country dimension, so refArea was not applied.`);
      }
      key = structure.dimensions.map((dimension) => (dimension.id === "REF_AREA" && hasArea ? area : "")).join(".");
      if (key.split(".").every((part) => part === "")) key = "";
    }

    const all = await fetchData({ flow, key, detail: "nodata" }, context.cache, context.ttl, context.signal);
    const needles = words(input.words);
    const matches = all.filter((series) =>
      matchesAll(
        [
          series.key,
          attributeText(series, "TITLE") ?? "",
          attributeText(series, "TITLE_COMPL") ?? "",
          ...Object.values(series.dimensions).map((value) => value.name ?? ""),
        ].join(" "),
        needles,
      ),
    );

    const limit = input.limit ?? DEFAULT_SERIES;
    const dimensions = structure.dimensions.map((dimension) => {
      const counts = new Map<string, { code: string; name: string | null; series: number }>();
      for (const series of matches) {
        const value = series.dimensions[dimension.id];
        if (!value?.code) continue;
        const entry = counts.get(value.code) ?? { code: value.code, name: value.name, series: 0 };
        entry.series += 1;
        counts.set(value.code, entry);
      }
      const codes = [...counts.values()].sort((a, b) => b.series - a.series);
      return {
        id: dimension.id,
        position: dimension.position,
        codes: codes.slice(0, MAX_CODES_PER_DIMENSION),
        ...(codes.length > MAX_CODES_PER_DIMENSION ? { moreCodes: codes.length - MAX_CODES_PER_DIMENSION } : {}),
      };
    });

    const superseded = SUPERSEDED[flow];
    if (superseded) notes.push(superseded);
    const elsewhere = COMPILED_ELSEWHERE[structure.agency];
    if (elsewhere) notes.push(elsewhere);
    if (matches.length === 0) {
      notes.push(
        all.length === 0
          ? "This flow holds no series for that selection."
          : `None of the ${all.length} series in this selection has every one of those words in its title; try fewer or other words.`,
      );
    }

    return {
      flow,
      name: structure.name,
      agency: structure.agency,
      key: key === "" ? null : key,
      total: matches.length,
      truncated: matches.length > limit,
      dimensions,
      series: matches.slice(0, limit).map((series) => ({
        key: series.key,
        title: attributeText(series, "TITLE"),
        titleComplement: attributeText(series, "TITLE_COMPL"),
        unit: attributeText(series, "UNIT"),
        frequency: series.dimensions.FREQ?.name ?? null,
      })),
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_series                                                                 */
/* -------------------------------------------------------------------------- */

const MAX_SERIES = 20;
const MAX_OBSERVATIONS = 2_000;
const DEFAULT_OBSERVATIONS = 12;
const MAX_LAST_OBSERVATIONS = 2_000;

export const getSeriesTool = defineTool({
  name: "get_series",
  title: "Read ECB series",
  description:
    "The observations of one or more ECB series, by flow and key, with what each series is, its unit and multiplier, and the status of any value that is estimated, provisional or withheld. " +
    "The key is one code per dimension separated by dots (find_series lists them); leave a part empty to take every code, or join codes with + to take several — M.GR+CY+PT.L.L40.CI.0000.EUR.N.Z is three countries' bond yields. " +
    `Give startPeriod and/or endPeriod (2025, 2025-Q2, 2025-09, 2025-10-14), or lastObservations for the latest N; with neither, the latest ${DEFAULT_OBSERVATIONS}. ` +
    `At most ${MAX_SERIES} series and ${MAX_OBSERVATIONS.toLocaleString("en-US")} observations come back, the most recent kept. ` +
    "Each series says whether it looks discontinued — some flows answer for years after they stopped — and values are exactly as published.",
  inputSchema: {
    flow: z.string().trim().min(1).max(40).describe("The dataflow id, e.g. IRS, MIR, EXR."),
    key: z.string().trim().min(1).max(400).describe("The series key, e.g. M.GR.L.L40.CI.0000.EUR.N.Z. Empty parts are wildcards; + joins codes."),
    startPeriod: z.string().trim().max(10).optional().describe("First period: 2020, 2020-S1, 2020-Q1, 2020-01, 2020-W01 or 2020-01-15. Not after today."),
    endPeriod: z.string().trim().max(10).optional().describe("Last period, same formats."),
    lastObservations: z
      .number()
      .int()
      .min(1)
      .max(MAX_LAST_OBSERVATIONS)
      .optional()
      .describe(`The latest N observations of each series (inside the window, if one is given). Defaults to ${DEFAULT_OBSERVATIONS} when no period is given.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { flow: "IRS", key: "M.GR.L.L40.CI.0000.EUR.N.Z", lastObservations: 12 },
  async handler(input, context) {
    const flow = normalizeFlow(input.flow);
    const structure = await fetchStructure(flow, context.cache, context.signal);
    const key = normalizeKey(input.key, structure.dimensions);
    const { startPeriod, endPeriod } = checkPeriods(input.startPeriod, input.endPeriod);
    const lastObservations =
      input.lastObservations ?? (startPeriod === undefined && endPeriod === undefined ? DEFAULT_OBSERVATIONS : undefined);

    const all = await fetchData({ flow, key, startPeriod, endPeriod, lastObservations }, context.cache, context.ttl, context.signal);

    const notes: string[] = [];
    if (all.length === 0) {
      notes.push("The key matches, but there are no observations in that window: none published yet, or none in those periods.");
    }

    const kept = all.slice(0, MAX_SERIES);
    if (all.length > MAX_SERIES) {
      notes.push(`The key matched ${all.length} series; the first ${MAX_SERIES} by key are here. Fix more parts of the key to choose.`);
    }

    const perSeries = Math.max(1, Math.floor(MAX_OBSERVATIONS / Math.max(kept.length, 1)));
    let cut = false;
    const series = kept.map((entry) => {
      const observations = entry.observations.slice(-perSeries);
      if (observations.length < entry.observations.length) cut = true;
      const stale = isStale(entry);
      const thirdParty = thirdPartyNote(flow, entry);
      if (thirdParty) notes.push(thirdParty);
      return {
        ...describeSeries(entry),
        firstPeriod: observations[0]?.period ?? null,
        lastPeriod: observations.at(-1)?.period ?? null,
        stale,
        observations,
      };
    });
    if (cut) {
      notes.push(`Kept the latest ${perSeries} observations of each series. Narrow the window, or ask for fewer series, to see further back.`);
    }
    if (series.some((entry) => entry.stale)) {
      notes.push("At least one series has not been updated for far longer than its frequency allows: it has most likely been discontinued, so its last value is not the current state.");
    }
    const superseded = SUPERSEDED[flow];
    if (superseded) notes.push(superseded);
    const elsewhere = COMPILED_ELSEWHERE[structure.agency];
    if (elsewhere) notes.push(elsewhere);
    notes.push(REUSE_NOTE);

    return {
      flow,
      name: structure.name,
      key,
      count: series.length,
      series,
      notes: [...new Set(notes)],
    };
  },
});

export const tools = [getExchangeRateTool, listGreekIndicatorsTool, searchDataflowsTool, findSeriesTool, getSeriesTool];
