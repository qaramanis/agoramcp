import { defineTool, InvalidInputError, NotFoundError, type Cache } from "@agoramcp/core";
import { z } from "zod";
import {
  addDays,
  athensToday,
  fetchFileTypes,
  fetchWorkbook,
  latestVersions,
  listFiles,
  parseForecast,
  parseRealisation,
  resolveFileType,
  type AdmieFile,
  type RealisationKey,
} from "./client.ts";

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

/** A list reaching the last two days can still grow; an older one will not. */
function listTtl(to: string): number {
  return to >= addDays(athensToday(), -2) ? 900 : 86_400;
}

/**
 * What the files people actually want hold, in plain words. The upstream
 * vocabulary names a process and a data type, never what is inside.
 */
const MEANINGS: Record<string, string> = {
  SystemRealizationSCADA:
    "Hourly actuals for one day: total, net and Attica load, pumping, imports and exports per border, and the output of every lignite, oil, gas, hydro, transmission-connected renewable and battery unit, with totals by fuel. .xls, from 2011. The best single file; get_daily_energy reads it.",
  DailyEnergyBalanceAnalysis: "The day's energy mix: MWh and share for lignite, gas, hydro, renewables and net imports. .xlsx, continuous from 2021.",
  RealTimeSCADASystemLoad: "Hourly net load without Crete, and the Crete cable flows. .xls; a gap from February 2018 to May 2020.",
  RealTimeSCADARES: "Hourly output of transmission-connected renewables. .xls.",
  RealTimeSCADAImportsExports: "Hourly net flow on each border: Albania, North Macedonia, Bulgaria, Turkey, Italy (exports negative). .xls.",
  RESMV: "Hourly output and installed capacity of distribution-connected (MV) renewables — most solar — in kWh and kW. .xls, a day later.",
  ReservoirFillingRate: "How full each hydro reservoir is, as a fraction of 1, with the total. .xls.",
  ISP1DayAheadLoadForecast: "Tomorrow's load forecast in 96 quarter-hours, MW; version 1 about 09:20, version 2 about 13:20 the day before. get_forecast reads it.",
  ISP1DayAheadRESForecast: "Tomorrow's renewables forecast in 96 quarter-hours, MW. get_forecast reads it.",
  ISP1ISPResults: "The day-ahead integrated scheduling result in quarter-hours: load, losses, production by type, cross-border schedules, energy marginal prices and balancing. .xlsx, eight sheets.",
  ISP1UnitAvailabilities: "Each unit's declared availability for the dispatch day.",
  ISP1Requirements: "Reserve requirements for the dispatch day.",
};

/* -------------------------------------------------------------------------- */
/* list_file_types                                                            */
/* -------------------------------------------------------------------------- */

export const listFileTypesTool = defineTool({
  name: "list_file_types",
  title: "Which files ΑΔΜΗΕ publishes",
  description:
    "The 74 kinds of file the transmission operator publishes, each with the code list_files takes, the process and data type it belongs to in English and Greek, the period one file covers and how often it appears — and, for the dozen most useful, what is inside in plain words. " +
    "Start here to find a code: SystemRealizationSCADA is the day's actual load and production by fuel, ISP1DayAheadLoadForecast tomorrow's load, RealTimeSCADAImportsExports the border flows, ReservoirFillingRate the hydro reservoirs. " +
    "Codes for the old market (DayAheadLoadForecast, DispatchSchedulingResults, UnitProduction…) still exist but no longer get files; the ISP codes replaced them.",
  inputSchema: {
    search: z.string().trim().max(100).optional().describe("Words to find in a code, process or data type, e.g. \"SCADA\", \"forecast\", \"reservoir\"."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { search: "SCADA" },
  async handler(input, context) {
    const types = await fetchFileTypes(context.cache, context.signal);
    const needles = (input.search ?? "").toLowerCase().split(/\s+/u).filter(Boolean);
    const matching = types.filter((type) => {
      const text = [type.code, type.process, type.dataType, type.processEl, type.dataTypeEl].join(" ").toLowerCase();
      return needles.every((needle) => text.includes(needle));
    });
    return {
      total: matching.length,
      fileTypes: matching.map((type) => ({ ...type, ...(MEANINGS[type.code] ? { contents: MEANINGS[type.code] } : {}) })),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* list_files                                                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 93;

export const listFilesTool = defineTool({
  name: "list_files",
  title: "Find ΑΔΜΗΕ's files for a period",
  description:
    "The files of one type whose coverage falls in a window, newest first, each with its url (for read_file), the period it covers, its version and when it was published. " +
    `The window defaults to the last ${DEFAULT_WINDOW_DAYS} days and can span up to ${MAX_WINDOW_DAYS}. ` +
    "A day can have more than one version — a correction is a new upload, not a replacement — and by default only the latest version of each period is listed. " +
    "Day-ahead files appear before their day: tomorrow's forecast is listed today.",
  inputSchema: {
    fileType: z.string().trim().min(2).max(60).describe("A code from list_file_types, e.g. SystemRealizationSCADA. Case does not matter."),
    from: z.string().trim().optional().describe(`First day, YYYY-MM-DD. Defaults to ${DEFAULT_WINDOW_DAYS - 1} days before to.`),
    to: z.string().trim().optional().describe("Last day, YYYY-MM-DD. Defaults to tomorrow, so day-ahead files are included."),
    allVersions: z.boolean().optional().describe("List every upload, not just the latest of each period."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { fileType: "SystemRealizationSCADA" },
  async handler(input, context) {
    const type = await resolveFileType(input.fileType, context.cache, context.signal);
    const to = input.to === undefined ? addDays(athensToday(), 1) : readDay(input.to, "to");
    const from = input.from === undefined ? addDays(to, -(DEFAULT_WINDOW_DAYS - 1)) : readDay(input.from, "from");
    if (from > to) throw new InvalidInputError("from is after to.");
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    if (days > MAX_WINDOW_DAYS) {
      throw new InvalidInputError(`That window is ${days} days; the most is ${MAX_WINDOW_DAYS}. ΑΔΜΗΕ's listing slows to tens of seconds over years.`);
    }

    const all = await listFiles(type.code, from, to, context.cache, listTtl(to), context.signal);
    const files = input.allVersions ? all : latestVersions(all);
    return {
      fileType: type.code,
      dataType: type.dataType,
      from,
      to,
      count: files.length,
      files,
      ...(files.length === 0
        ? { notes: [`No ${type.code} file covers ${from} to ${to}. Some types are no longer published (list_file_types); a daily file appears the morning after its day.`] }
        : {}),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* read_file                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_ROWS = 100;
const MAX_ROWS = 200;
const MAX_CELLS_RETURNED = 20_000;

export const readFileTool = defineTool({
  name: "read_file",
  title: "Read an ΑΔΜΗΕ workbook",
  description:
    "The contents of one .xls or .xlsx file from list_files: its sheets with their sizes, and the rows of one sheet, paged. " +
    "Rows come as { row, cells }, row numbers as in the spreadsheet (1-based), empty rows left out, cells as numbers, text, or ISO dates where the cell is formatted as one. " +
    `At most ${MAX_ROWS} rows a call; read \`nextOffset\` to continue. ` +
    "The XDO_METADATA sheet in many files is the report generator's field list, not data. Labels are Greek in older files and English in newer ones; SCADA files say on their first line that the figures are not certified.",
  inputSchema: {
    url: z.string().trim().url().max(500).describe("A file's url from list_files."),
    sheet: z.string().trim().max(100).optional().describe("Sheet name. Defaults to the first sheet that is not XDO_METADATA."),
    offset: z.number().int().min(0).optional().describe("Rows to skip, counting only non-empty rows. Defaults to 0."),
    limit: z.number().int().min(1).max(MAX_ROWS).optional().describe(`Most rows, 1-${MAX_ROWS}. Defaults to ${DEFAULT_ROWS}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: {
    url: "https://www.admie.gr/sites/default/files/attached-files/type-file/2026/10/20261014_ISP1DayAheadLoadForecast_02.xlsx",
  },
  async handler(input, context) {
    const workbook = await fetchWorkbook(input.url, context.cache, context.signal);
    const sheet =
      input.sheet === undefined
        ? (workbook.sheets.find((candidate) => candidate.name !== "XDO_METADATA" && candidate.rows.length > 0) ?? workbook.sheets[0])
        : workbook.sheets.find((candidate) => candidate.name.toLowerCase() === input.sheet?.toLowerCase());
    if (!sheet) {
      throw new NotFoundError(`The file has no sheet "${input.sheet}". Its sheets are ${workbook.sheets.map((s) => s.name).join(", ")}.`);
    }

    const filled = sheet.rows.map((cells, index) => ({ row: index + 1, cells })).filter((row) => row.cells.length > 0);
    const offset = input.offset ?? 0;
    const limit = input.limit ?? DEFAULT_ROWS;
    const page: typeof filled = [];
    let cells = 0;
    for (const row of filled.slice(offset, offset + limit)) {
      if (cells + row.cells.length > MAX_CELLS_RETURNED && page.length > 0) break;
      page.push(row);
      cells += row.cells.length;
    }
    const next = offset + page.length;

    return {
      url: input.url,
      sheets: workbook.sheets.map((candidate) => ({
        name: candidate.name,
        rows: candidate.rows.filter((row) => row.length > 0).length,
        columns: Math.max(0, ...candidate.rows.map((row) => row.length)),
      })),
      sheet: sheet.name,
      offset,
      count: page.length,
      nextOffset: next < filled.length ? next : null,
      rows: page,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_daily_energy                                                           */
/* -------------------------------------------------------------------------- */

/** The newest version of one daily file type for one day, or a not_found that says why. */
async function dailyFile(code: string, date: string, cache: Cache, signal: AbortSignal): Promise<AdmieFile> {
  const files = latestVersions(await listFiles(code, date, date, cache, listTtl(date), signal)).filter(
    (file) => file.coverageFrom === date,
  );
  const file = files[0];
  if (!file) {
    throw new NotFoundError(
      date >= addDays(athensToday(), -1)
        ? `ΑΔΜΗΕ has not published ${code} for ${date} yet. The day's file usually appears around 06:00 the next morning.`
        : `ΑΔΜΗΕ has no ${code} file for ${date}.`,
    );
  }
  return file;
}

const ENERGY_GROUPS: Record<string, RealisationKey[]> = {
  load: ["totalLoad", "netLoad", "atticaLoad", "pumping"],
  generation: ["lignite", "gas", "oil", "hydro", "renewables", "storage"],
  interconnections: ["imports", "exports", "netExports"],
};

export const getDailyEnergyTool = defineTool({
  name: "get_daily_energy",
  title: "Greece's electricity on a day",
  description:
    "How much electricity Greece used on a day and what produced it, in MWh, from the operator's system realisation file: total, net and Attica load and pumping; lignite, gas, oil, hydro, renewables and battery output; imports, exports and the net balance. " +
    "With no date, yesterday, which is published around 06:00 the next morning; any day back to 1 January 2011. Set hourly to get each hour's figure as well. " +
    "Read the renewables figure with care: it counts only plants connected to the transmission grid, and most solar is connected to distribution, so it understates the real renewable share (RESMV, via list_files, has those). Before the 2020s the renewables row is wind alone. netExports is exports minus imports: negative means Greece imported more than it exported. " +
    "The operator marks these SCADA figures as not certified.",
  inputSchema: {
    date: z.string().trim().optional().describe("The day, YYYY-MM-DD, from 2011-01-01. Defaults to yesterday in Athens."),
    hourly: z.boolean().optional().describe("Also return each hour's MWh. Defaults to false."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { date: "2026-10-14" },
  async handler(input, context) {
    const date = input.date === undefined ? addDays(athensToday(), -1) : readDay(input.date, "date");
    if (date < "2011-01-01") throw new InvalidInputError("The realisation files begin on 2011-01-01.");

    const file = await dailyFile("SystemRealizationSCADA", date, context.cache, context.signal);
    const realisation = parseRealisation(await fetchWorkbook(file.url, context.cache, context.signal), date);

    const group = (keys: RealisationKey[]) =>
      Object.fromEntries(
        keys
          .filter((key) => realisation.rows[key])
          .map((key) => {
            const row = realisation.rows[key];
            return [key, input.hourly ? { total: row?.total ?? null, hourly: row?.hourly ?? [] } : (row?.total ?? null)];
          }),
      );

    const notes = [
      "Renewables here are transmission-connected only; distribution-connected plants, most of the solar fleet, are in RESMV.",
      "Figures are SCADA measurements the operator marks as not certified.",
    ];
    if (realisation.rows.renewables?.label.toUpperCase().includes("ΑΙΟΛΙΚ")) {
      notes.unshift("In this file the renewables row is wind alone: the file predates the operator counting other renewables in it.");
    }
    if (realisation.hours !== 24) {
      notes.push(`${date} has ${realisation.hours} hours: clocks changed that night.`);
    }

    return {
      date,
      unit: "MWh",
      hoursInDay: realisation.hours,
      load: group(ENERGY_GROUPS.load ?? []),
      generation: group(ENERGY_GROUPS.generation ?? []),
      interconnections: group(ENERGY_GROUPS.interconnections ?? []),
      file: { url: file.url, version: file.version, publishedAt: file.publishedAt },
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_forecast                                                               */
/* -------------------------------------------------------------------------- */

async function readForecast(code: string, date: string, cache: Cache, signal: AbortSignal) {
  const file = await dailyFile(code, date, cache, signal);
  const { values } = parseForecast(await fetchWorkbook(file.url, cache, signal));
  const numbers = values.map((value, index) => ({ quarter: index + 1, value })).filter((entry): entry is { quarter: number; value: number } => entry.value !== null);
  const peak = numbers.reduce<{ quarter: number; value: number } | null>((best, entry) => (best === null || entry.value > best.value ? entry : best), null);
  const low = numbers.reduce<{ quarter: number; value: number } | null>((best, entry) => (best === null || entry.value < best.value ? entry : best), null);
  const at = (quarter: number) => {
    const minutes = (quarter - 1) * 15;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };
  return {
    version: file.version,
    publishedAt: file.publishedAt,
    url: file.url,
    peak: peak ? { start: at(peak.quarter), mw: peak.value } : null,
    low: low ? { start: at(low.quarter), mw: low.value } : null,
    quarterHours: values,
  };
}

export const getForecastTool = defineTool({
  name: "get_forecast",
  title: "Tomorrow's electricity forecast",
  description:
    "The operator's day-ahead forecast of Greek load and of renewable output, in MW for each quarter-hour of the day (the first is 00:00–00:15), with the peak and the low and when each falls. " +
    "With no date, tomorrow; the first version appears around 09:20 the day before and a revised one around 13:20, and the latest is used. Any day back to 20 October 2020, when the ISP began. " +
    "These are forecasts made before the day, not what happened: get_daily_energy has the actuals.",
  inputSchema: {
    date: z.string().trim().optional().describe("The dispatch day, YYYY-MM-DD, from 2020-10-20. Defaults to tomorrow in Athens."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { date: "2026-10-14" },
  async handler(input, context) {
    const date = input.date === undefined ? addDays(athensToday(), 1) : readDay(input.date, "date");
    if (date < "2020-10-20") throw new InvalidInputError("The ISP forecasts begin on 2020-10-20.");

    const [load, renewables] = await Promise.all([
      readForecast("ISP1DayAheadLoadForecast", date, context.cache, context.signal),
      readForecast("ISP1DayAheadRESForecast", date, context.cache, context.signal).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      }),
    ]);

    return {
      date,
      unit: "MW",
      load,
      renewables,
      notes: [
        ...(renewables === null ? ["No renewables forecast is published for this day yet."] : []),
        ...(load.quarterHours.length !== 96 ? [`This day has ${load.quarterHours.length} quarter-hours: clocks changed that night.`] : []),
      ],
    };
  },
});

export const tools = [listFileTypesTool, listFilesTool, readFileTool, getDailyEnergyTool, getForecastTool];
