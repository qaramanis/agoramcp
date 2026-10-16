import { defineTool, InvalidInputError } from "@agoramcp/core";
import { z } from "zod";
import {
  fetchCatalogue,
  fetchCube,
  fetchStructure,
  LATEST_SLACK,
  PERIODS_PER_YEAR,
  periodYears,
  type Cell,
  type DatasetInfo,
  type DimensionInfo,
} from "./client.ts";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return fold(text).split(/[\s,;]+/u).filter((word) => word !== "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The citation Eurostat asks for: the dataset's DOI and the day it was read.
 * A dataset without a DOI is cited by its page in the data browser.
 */
function citation(info: DatasetInfo): string {
  const where = info.doi
    ? `https://doi.org/${info.doi}`
    : `https://ec.europa.eu/eurostat/databrowser/view/${info.code}/default/table`;
  return `Source: Eurostat, ${where}, accessed ${today()}`;
}

function discontinuedNote(info: DatasetInfo): string | null {
  if (!info.discontinued) return null;
  return `${info.code} is discontinued and no longer updated${info.replacedBy ? `; Eurostat names ${info.replacedBy} as its replacement` : ""}. Its last values are not the current state.`;
}

/**
 * Countries whose data Eurostat licenses for any reuse: the member states,
 * EFTA, and the official candidates. For anywhere else — the UK, the US,
 * Japan — reuse is non-commercial only. A regional (NUTS) code starts with
 * its country's, and EU and euro-area aggregates are Eurostat's own.
 */
const OPEN_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU",
  "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
  "IS", "LI", "NO", "CH",
  "AL", "BA", "GE", "MD", "ME", "MK", "RS", "TR", "UA",
]);

function restrictedGeos(codes: readonly string[]): string[] {
  return codes.filter((code) => {
    if (/^(EU|EA|EFTA|EEA)/u.test(code)) return false;
    return !OPEN_COUNTRIES.has(code.slice(0, 2));
  });
}

function resolveCode(dataset: string, dimension: DimensionInfo, given: string): string {
  const wanted = given.trim().toUpperCase();
  const found = dimension.codes.find((code) => code.code.toUpperCase() === wanted);
  if (found) return found.code;

  if (dimension.id === "geo" && wanted === "GR") {
    throw new InvalidInputError("Eurostat writes Greece as EL, not GR; its regions are EL3, EL30 (Attiki), EL52 and so on.");
  }
  const sample = dimension.codes.slice(0, 15).map((code) => `${code.code} (${code.label})`).join(", ");
  throw new InvalidInputError(
    `"${given}" is not a code of ${dimension.id} in ${dataset}. It has ${dimension.codes.length} codes, among them ${sample}. get_dataset_structure with dimension "${dimension.id}" and search lists the rest.`,
  );
}

/* -------------------------------------------------------------------------- */
/* search_datasets                                                            */
/* -------------------------------------------------------------------------- */

const DEFAULT_RESULTS = 20;
const MAX_RESULTS = 50;

export const searchDatasetsTool = defineTool({
  name: "search_datasets",
  title: "Find a Eurostat dataset",
  description:
    "Find Eurostat datasets by English words in their title, code or the folders they sit in, and get each one's code, the period it covers and when it was last updated. " +
    "Every figure comes from a dataset with a short code — une_rt_m is monthly unemployment, prc_hicp_minr monthly inflation, namq_10_gdp quarterly GDP, tps00001 population — and get_data needs that code. " +
    "Titles are English only, so search \"unemployment\", not \"ανεργία\". A `table` is a small curated view, often the quickest answer; a `dataset` is the full cube behind it. " +
    "A dataset whose data ends years before its neighbours' has usually been replaced; get_dataset_structure says so when Eurostat marks it discontinued.",
  inputSchema: {
    query: z.string().trim().min(1).max(200).describe("English words, all of which must appear, e.g. \"unemployment monthly\", \"house price index\", \"nights tourist accommodation\"."),
    type: z.enum(["dataset", "table"]).optional().describe("Only full datasets, or only curated tables. Both by default."),
    limit: z.number().int().min(1).max(MAX_RESULTS).optional().describe(`Most results, 1-${MAX_RESULTS}. Defaults to ${DEFAULT_RESULTS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { query: "unemployment monthly" },
  async handler(input, context) {
    const entries = await fetchCatalogue(context.cache, context.signal);
    const needles = words(input.query);

    const scored = entries
      .filter((entry) => input.type === undefined || entry.type === input.type)
      .map((entry) => {
        const own = fold(`${entry.title} ${entry.code}`);
        const everywhere = `${own} ${fold(entry.path.join(" "))}`;
        if (!needles.every((needle) => everywhere.includes(needle))) return null;
        const exact = needles.length === 1 && fold(entry.code) === needles[0];
        const inTitle = needles.filter((needle) => own.includes(needle)).length;
        return { entry, score: (exact ? 1_000 : 0) + inTitle * 10 + (entry.type === "table" ? 1 : 0) };
      })
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.entry.dataEnd ?? "").localeCompare(a.entry.dataEnd ?? "") ||
          a.entry.title.length - b.entry.title.length,
      );

    const limit = input.limit ?? DEFAULT_RESULTS;
    return {
      total: scored.length,
      truncated: scored.length > limit,
      datasets: scored.slice(0, limit).map(({ entry }) => entry),
      ...(scored.length === 0
        ? { notes: ["Nothing matches every one of those words. Titles are English; try fewer or more general words."] }
        : {}),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_dataset_structure                                                      */
/* -------------------------------------------------------------------------- */

const CODES_PER_DIMENSION = 100;
const MAX_CODES = 1_000;

export const getDatasetStructureTool = defineTool({
  name: "get_dataset_structure",
  title: "What a Eurostat dataset holds",
  description:
    "The dimensions of one dataset and the codes each one takes, with labels — what get_data's filters accept — plus the period it covers, when it was updated, its DOI and whether Eurostat has discontinued it. " +
    "Read it before get_data to learn, for instance, that une_rt_m is broken down by freq, s_adj, age, unit, sex and geo, and that its unemployment rate is unit PC_ACT. " +
    `Each dimension lists its first ${CODES_PER_DIMENSION} codes; name a dimension, and give \`search\`, to see more of a large one — 555 consumption categories in prc_hicp_minr, 512 regions in a regional dataset. ` +
    "Greece is EL, and its regions are NUTS codes that start with EL: EL3 and EL30 Attiki, EL52 Kentriki Makedonia.",
  inputSchema: {
    dataset: z.string().trim().min(1).max(60).describe("The dataset code, e.g. une_rt_m. search_datasets finds it."),
    dimension: z.string().trim().max(40).optional().describe("Only this dimension, with all of its codes that match `search`."),
    search: z.string().trim().max(200).optional().describe("Words or codes to find among the codes, e.g. \"Attiki\", \"electricity\", \"EL5\"."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { dataset: "une_rt_m" },
  async handler(input, context) {
    const info = await fetchStructure(input.dataset, context.cache, context.signal);

    let dimensions = info.dimensions;
    if (input.dimension !== undefined) {
      const wanted = input.dimension.toLowerCase();
      dimensions = dimensions.filter((dimension) => dimension.id.toLowerCase() === wanted);
      if (dimensions.length === 0) {
        throw new InvalidInputError(
          `${info.code} has no dimension "${input.dimension}". Its dimensions are ${info.dimensions.map((d) => d.id).join(", ")}, and time.`,
        );
      }
    }

    const needles = input.search === undefined ? [] : words(input.search);
    const cap = input.dimension === undefined ? CODES_PER_DIMENSION : MAX_CODES;

    const notes: string[] = [];
    const discontinued = discontinuedNote(info);
    if (discontinued) notes.push(discontinued);
    if (info.dimensions.some((dimension) => dimension.id === "geo")) {
      notes.push("Greece is EL. Regions are NUTS codes: EL3 and EL30 (Attiki), EL41 to EL65 for the rest.");
    }

    return {
      code: info.code,
      title: info.title,
      updated: info.updated,
      observations: info.observations,
      period: { oldest: info.oldestPeriod, latest: info.latestPeriod },
      doi: info.doi,
      citation: citation(info),
      discontinued: info.discontinued,
      replacedBy: info.replacedBy,
      description: info.description,
      dimensions: dimensions.map((dimension) => {
        const matching =
          needles.length === 0
            ? dimension.codes
            : dimension.codes.filter((code) => {
                const text = fold(`${code.code} ${code.label}`);
                return needles.every((needle) => text.includes(needle));
              });
        return {
          id: dimension.id,
          label: dimension.label,
          size: dimension.codes.length,
          ...(needles.length > 0 ? { matching: matching.length } : {}),
          codes: matching.slice(0, cap),
          ...(matching.length > cap ? { truncated: true } : {}),
        };
      }),
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_data                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_ROWS = 200;
const MAX_ROWS = 1_000;
const MAX_LAST_PERIODS = 60;
/**
 * The most cells a selection may span before it is refused. Eurostat streams
 * whatever is asked for, however large; twenty thousand is a few hundred KB
 * and far more than one answer can usefully hold.
 */
const MAX_CELLS = 20_000;

/**
 * `unit=PC_ACT; sex=T; geo=EL,DE` → { unit: ["PC_ACT"], sex: ["T"], geo: ["EL", "DE"] }.
 * Text rather than an object, so the same call works over MCP, a GET query
 * string and the playground's form.
 */
export function parseFilters(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of text.split(/[;&\n]+/u)) {
    if (part.trim() === "") continue;
    const match = /^\s*([A-Za-z0-9_]+)\s*[=:]\s*(.+?)\s*$/u.exec(part);
    if (!match) {
      throw new InvalidInputError(`"${part.trim()}" is not a filter. Write each as dimension=code, codes joined by commas, filters by semicolons: "unit=PC_ACT; sex=T; age=TOTAL".`);
    }
    const [, dimension = "", codes = ""] = match;
    out[dimension] = [...(out[dimension] ?? []), ...codes.split(/[\s,]+/u).filter(Boolean)];
  }
  return out;
}

export const getDataTool = defineTool({
  name: "get_data",
  title: "Read Eurostat figures",
  description:
    "Figures from one Eurostat dataset, for the countries, breakdowns and periods asked for, as labelled rows. " +
    "`filters` fixes dimensions by code — get_dataset_structure lists them — as text: \"unit=PC_ACT; sex=T; age=TOTAL; s_adj=SA\"; a dimension left out takes every code. " +
    "`geo` takes country codes, comma-separated, and defaults to EL, Greece; add EU27_2020 for the EU and EA for the euro area to compare. " +
    `For the latest figures give lastPeriods (each series' own latest N, even where Greece reports later than others), or a window with startPeriod/endPeriod (2025, 2025-Q2, 2025-09); with neither, the latest one. ` +
    `A selection that would span more than ${MAX_CELLS.toLocaleString("en-US")} cells is refused with the dimensions to narrow, and at most ${MAX_ROWS} rows come back. ` +
    "Values carry Eurostat's flags — p provisional, e estimated, b break in series, c or |C confidential — and an answer comes with the citation Eurostat asks for.",
  inputSchema: {
    dataset: z.string().trim().min(1).max(60).describe("The dataset code, e.g. une_rt_m, prc_hicp_minr, namq_10_gdp."),
    filters: z
      .string()
      .trim()
      .max(1_000)
      .optional()
      .describe("Codes by dimension: dimension=code, several codes joined by commas, filters by semicolons, e.g. \"unit=PC_ACT; sex=T; age=TOTAL; s_adj=SA\". Codes are matched case-insensitively."),
    geo: z
      .string()
      .trim()
      .min(2)
      .max(600)
      .optional()
      .describe("Countries or regions, comma-separated, e.g. \"EL,EU27_2020,EA\". Defaults to EL where the dataset has Greece. Greece is EL, not GR."),
    startPeriod: z.string().trim().max(10).optional().describe("First period: 2020, 2020-S1, 2020-Q1, 2020-01, 2020-W01 or 2020-01-15."),
    endPeriod: z.string().trim().max(10).optional().describe("Last period, same formats."),
    lastPeriods: z
      .number()
      .int()
      .min(1)
      .max(MAX_LAST_PERIODS)
      .optional()
      .describe(`Each series' latest N periods, 1-${MAX_LAST_PERIODS}. Not with startPeriod/endPeriod. Defaults to 1 when no window is given.`),
    limit: z.number().int().min(1).max(MAX_ROWS).optional().describe(`Most rows, 1-${MAX_ROWS}. Defaults to ${DEFAULT_ROWS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {
    dataset: "une_rt_m",
    filters: "unit=PC_ACT; sex=T; age=TOTAL; s_adj=SA",
    geo: "EL,EA21,EU27_2020",
    lastPeriods: 3,
  },
  async handler(input, context) {
    const info = await fetchStructure(input.dataset, context.cache, context.signal);
    const byId = new Map(info.dimensions.map((dimension) => [dimension.id.toLowerCase(), dimension]));
    const notes: string[] = [];

    // Filters, checked against the structure: upstream answers an unknown
    // code with an empty 200 rather than an error.
    const filters: Record<string, string[]> = {};
    for (const [name, given] of Object.entries(input.filters === undefined ? {} : parseFilters(input.filters))) {
      if (name.toLowerCase() === "time") {
        throw new InvalidInputError("Time is not a filter: use startPeriod/endPeriod or lastPeriods.");
      }
      const dimension = byId.get(name.toLowerCase());
      if (!dimension) {
        throw new InvalidInputError(
          `${info.code} has no dimension "${name}". Its dimensions are ${info.dimensions.map((d) => d.id).join(", ")}.`,
        );
      }
      filters[dimension.id] = [...new Set(given.map((code) => resolveCode(info.code, dimension, code)))];
    }

    const geo = byId.get("geo");
    if (input.geo !== undefined) {
      if (!geo) throw new InvalidInputError(`${info.code} has no geo dimension, so geo cannot be applied.`);
      if (filters.geo) throw new InvalidInputError("Give countries in geo or in filters.geo, not both.");
      filters.geo = [...new Set(input.geo.split(/[\s,;]+/u).filter(Boolean).map((code) => resolveCode(info.code, geo, code)))];
    } else if (geo && !filters.geo && geo.codes.some((code) => code.code === "EL")) {
      filters.geo = ["EL"];
      notes.push("geo defaulted to EL, Greece. Pass geo to compare: EU27_2020 is the EU, EA the euro area.");
    }

    // Frequency decides how many periods a window spans, and how much slack
    // the "latest" request needs.
    const frequencies = filters.freq ?? byId.get("freq")?.codes.map((code) => code.code) ?? ["A"];
    const perYear = Math.max(...frequencies.map((code) => PERIODS_PER_YEAR[code] ?? 12));
    const slack = Math.max(...frequencies.map((code) => LATEST_SLACK[code] ?? 6));

    const windowed = input.startPeriod !== undefined || input.endPeriod !== undefined;
    if (windowed && input.lastPeriods !== undefined) {
      throw new InvalidInputError("Give lastPeriods, or startPeriod/endPeriod, not both: Eurostat cannot combine them.");
    }
    for (const [field, value] of [["startPeriod", input.startPeriod], ["endPeriod", input.endPeriod]] as const) {
      if (value !== undefined && periodYears(value) === undefined) {
        throw new InvalidInputError(`${field} "${value}" is not a period. Use 2025, 2025-S1, 2025-Q2, 2025-09, 2025-W41 or 2025-10-14.`);
      }
    }
    const lastPeriods = windowed ? undefined : (input.lastPeriods ?? 1);

    // Estimated before asking, because upstream will stream any size.
    let periods: number;
    if (lastPeriods !== undefined) {
      periods = lastPeriods + slack;
    } else {
      const start = periodYears(input.startPeriod ?? info.oldestPeriod ?? "1990") ?? 1990;
      const end = periodYears(input.endPeriod ?? info.latestPeriod ?? today()) ?? new Date().getUTCFullYear();
      if (start > end) throw new InvalidInputError("startPeriod is after endPeriod.");
      periods = Math.max(1, Math.ceil((end - start) * perYear) + 1);
    }
    const series = info.dimensions.reduce((product, dimension) => product * (filters[dimension.id]?.length ?? dimension.codes.length), 1);
    if (series * periods > MAX_CELLS) {
      const open = info.dimensions
        .filter((dimension) => !filters[dimension.id] && dimension.codes.length > 1)
        .map((dimension) => `${dimension.id} (${dimension.codes.length} codes)`);
      throw new InvalidInputError(
        `That selection spans about ${(series * periods).toLocaleString("en-US")} cells, more than the ${MAX_CELLS.toLocaleString("en-US")} one call allows. ` +
          (open.length > 0 ? `Fix some of the dimensions left open: ${open.join(", ")}. ` : "") +
          "Or ask for fewer periods.",
      );
    }

    const cube = await fetchCube(
      {
        dataset: info.code,
        filters,
        sinceTimePeriod: input.startPeriod,
        untilTimePeriod: input.endPeriod,
        lastTimePeriod: lastPeriods === undefined ? undefined : lastPeriods + slack,
      },
      context.cache,
      context.ttl,
      context.signal,
    );

    // Each series' own latest N, where a "latest" was asked for.
    const others = cube.ids.filter((id) => id !== "time");
    const bySeries = new Map<string, Cell[]>();
    for (const cell of cube.cells) {
      const key = others.map((id) => cell.codes[id]).join("|");
      const list = bySeries.get(key);
      if (list) list.push(cell);
      else bySeries.set(key, [cell]);
    }
    const kept: Cell[] = [];
    for (const cells of bySeries.values()) {
      cells.sort((a, b) => (a.codes.time ?? "").localeCompare(b.codes.time ?? ""));
      kept.push(...(lastPeriods === undefined ? cells : cells.slice(-lastPeriods)));
    }

    const varying = others.filter((id) => (cube.dimensions[id]?.codes.length ?? 0) > 1);
    const constant: Record<string, { code: string; label: string }> = {};
    for (const id of others) {
      const codes = cube.dimensions[id]?.codes ?? [];
      if (codes.length === 1 && codes[0]) constant[id] = codes[0];
    }

    const limit = input.limit ?? DEFAULT_ROWS;
    const rows = kept.slice(0, limit).map((cell) => {
      const row: Record<string, string | number | null> = {};
      for (const id of varying) row[id] = cell.codes[id] ?? null;
      row.time = cell.codes.time ?? null;
      row.value = cell.value;
      row.flag = cell.flag;
      return row;
    });

    const labels: Record<string, Record<string, string>> = {};
    for (const id of varying) {
      const present = new Set(rows.map((row) => row[id]));
      labels[id] = Object.fromEntries(
        (cube.dimensions[id]?.codes ?? []).filter((code) => present.has(code.code)).map((code) => [code.code, code.label]),
      );
    }

    if (rows.length === 0) {
      notes.push(
        "No figures for that selection. The combination may not exist for these countries, or not in these periods; get_dataset_structure shows the codes and the period the dataset covers.",
      );
    }
    if (kept.length > limit) notes.push(`Stopped at ${limit} of ${kept.length} rows. Raise limit, or narrow the selection.`);
    const discontinued = discontinuedNote(info);
    if (discontinued) notes.push(discontinued);
    const restricted = restrictedGeos([...new Set(rows.map((row) => String(row.geo ?? constant.geo?.code ?? "")))].filter(Boolean));
    if (restricted.length > 0) {
      notes.push(
        `Eurostat licenses data on ${restricted.join(", ")} for non-commercial reuse only: they are outside the EU, EFTA and the candidate countries.`,
      );
    }

    return {
      dataset: { code: info.code, title: info.title, updated: info.updated, doi: info.doi },
      constant,
      labels,
      count: rows.length,
      truncated: kept.length > limit,
      rows,
      ...(Object.keys(cube.flags).length > 0 ? { flags: cube.flags } : {}),
      citation: citation(info),
      notes,
    };
  },
});

export const tools = [searchDatasetsTool, getDatasetStructureTool, getDataTool];
