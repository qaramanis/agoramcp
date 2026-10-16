import { cacheKey, defineTool, InvalidInputError, NotFoundError, withCache } from "@agoramcp/core";
import { z } from "zod";
import {
  extractText,
  fetchIssue,
  fetchPdf,
  KIND_NAMES,
  KINDS,
  pdfUrl,
  resolveSeries,
  searchGazette,
  searchLegislation,
  type IssueText,
  type Kind,
} from "./client.ts";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function currentYear(): number {
  return new Date().getUTCFullYear();
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function readDay(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (!DAY.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidInputError(`${field} "${value}" is not a date. Use YYYY-MM-DD, e.g. 2026-10-14.`);
  }
  return date;
}

const MAX_RANGE_DAYS = 31;

/** `"YYYY-MM-DD YYYY-MM-DD"`, the form both date filters take, or undefined. */
function dateRange(from: string | undefined, to: string | undefined, label: string): string | undefined {
  if (from === undefined && to === undefined) return undefined;
  const start = readDay(from ?? (to as string), `${label}From`);
  const end = readDay(to ?? (from as string), `${label}To`);
  if (start > end) throw new InvalidInputError(`${label}From is after ${label}To.`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new InvalidInputError(`A date range can span at most ${MAX_RANGE_DAYS} days; that one spans ${days}.`);
  }
  return `${start.toISOString().slice(0, 10)} ${end.toISOString().slice(0, 10)}`;
}

/** A result over periods that have closed will not change; one that reaches today can. */
function ttlFor(closed: boolean, live: number): number {
  return closed ? 86_400 : live;
}

/* -------------------------------------------------------------------------- */
/* search_legislation                                                         */
/* -------------------------------------------------------------------------- */

const MAX_YEARS = 11;
const DEFAULT_LEGISLATION = 20;
const MAX_LEGISLATION = 100;

export const searchLegislationTool = defineTool({
  name: "search_legislation",
  title: "Find a law or decree",
  description:
    "Find laws, presidential decrees and other legislative acts by their number, their year and the words in their title, and get the ΦΕΚ issue each was published in. " +
    "This is the index the Government Gazette keeps: \"ν. 4990/2022\" is kind law, number 4990, year 2022, and it was published in ΦΕΚ Α 210/2022. " +
    "Give a year (or a range of up to eleven years) or a number: numbering restarted in different eras, so law 2121 is four different laws (1892, 1920, 1952, 1993) and the year decides which. " +
    "`words` filters titles, which the index holds in capitals without accents; it is matched without regard to accents or case. " +
    "Each result carries the issue's id for get_gazette_issue (what amended it since) and get_gazette_text (what it says).",
  inputSchema: {
    kind: z
      .enum(KIND_NAMES)
      .optional()
      .describe(
        "law (Νόμος, the default), presidential_decree (ΠΔ), legislative_content_act (ΠΝΠ), royal_decree (ΒΔ), legislative_decree (ΝΔ), legislative_presidential_decree (ΝΠΔ), emergency_law (Αναγκαστικός Νόμος).",
      ),
    number: z.string().trim().min(1).max(10).optional().describe("The act's own number, e.g. \"4990\" — not the ΦΕΚ issue's."),
    year: z.number().int().min(1833).max(2100).optional().describe("The year it was published."),
    fromYear: z.number().int().min(1833).max(2100).optional().describe("First year of a range. Not with year."),
    toYear: z.number().int().min(1833).max(2100).optional().describe(`Last year of a range, at most ${MAX_YEARS} years after fromYear. Defaults to this year.`),
    words: z.string().trim().max(200).optional().describe("Words that must all appear in the title, e.g. \"προστασία προσώπων\" or \"ενέργεια\"."),
    limit: z.number().int().min(1).max(MAX_LEGISLATION).optional().describe(`Most results, newest first, 1-${MAX_LEGISLATION}. Defaults to ${DEFAULT_LEGISLATION}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { kind: "law", number: "4990", year: 2022 },
  async handler(input, context) {
    const kind: Kind = input.kind ?? "law";
    if (input.year !== undefined && (input.fromYear !== undefined || input.toYear !== undefined)) {
      throw new InvalidInputError("Give year, or fromYear/toYear, not both.");
    }

    let years: number[] = [];
    if (input.year !== undefined) {
      years = [input.year];
    } else if (input.fromYear !== undefined || input.toYear !== undefined) {
      const to = input.toYear ?? currentYear();
      const from = input.fromYear ?? to;
      if (from > to) throw new InvalidInputError("fromYear is after toYear.");
      if (to - from + 1 > MAX_YEARS) {
        throw new InvalidInputError(`A range can span at most ${MAX_YEARS} years; ask for it in parts.`);
      }
      years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    }
    if (years.length === 0 && input.number === undefined) {
      throw new InvalidInputError(
        "Give a year (or fromYear/toYear) or the act's number. The whole catalogue is too large to list: the decree catalogues alone run past 45 MB.",
      );
    }

    const closed = years.length > 0 && years.every((year) => year < currentYear());
    const acts = await searchLegislation(
      { kind, number: input.number, years },
      context.cache,
      ttlFor(closed, context.ttl),
      context.signal,
    );

    const needles = input.words === undefined ? [] : fold(input.words).split(/\s+/u).filter(Boolean);
    const matches = acts
      .filter((act) => needles.every((needle) => fold(act.title ?? "").includes(needle)))
      .sort(
        (a, b) =>
          (b.issueDate ?? "").localeCompare(a.issueDate ?? "") || Number(b.lawNumber ?? 0) - Number(a.lawNumber ?? 0),
      );

    const limit = input.limit ?? DEFAULT_LEGISLATION;
    const notes: string[] = [];
    if (matches.length === 0) {
      notes.push(
        acts.length === 0
          ? `No ${KINDS[kind].label} matches that number and year in the gazette's index.`
          : `None of the ${acts.length} acts found has every one of those words in its title.`,
      );
    }
    if (matches.length > limit) notes.push(`Showing the newest ${limit} of ${matches.length}. Raise limit or add words to narrow.`);

    return {
      kind,
      total: matches.length,
      truncated: matches.length > limit,
      acts: matches.slice(0, limit).map((act) => ({
        id: act.id,
        kind: act.kind,
        number: act.lawNumber,
        title: act.title,
        gazette: { series: act.series, number: act.number, year: act.year, label: act.label },
        issueDate: act.issueDate,
        releaseDate: act.releaseDate,
        pages: act.pages,
        pdfUrl: act.pdfUrl,
        pageUrl: act.pageUrl,
      })),
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* search_gazette                                                             */
/* -------------------------------------------------------------------------- */

const DEFAULT_ISSUES = 50;
const MAX_ISSUES = 200;

export const searchGazetteTool = defineTool({
  name: "search_gazette",
  title: "Search the Government Gazette",
  description:
    "Find ΦΕΚ issues of any series by year, issue number, the dates they were dated or released, or the words in them. " +
    "Series: Α laws and decrees, Β ministerial and regulatory decisions, Γ civil-service appointments, Δ planning and expropriations, Υ.Ο.Δ.Δ. senior appointments, Α.Σ.Ε.Π. recruitment notices, and others. " +
    "Typical calls: one issue (series Β, year 2026, number 6227); everything released on a day (releasedFrom alone); every Β issue dated in a week; issues of a year that contain a phrase. " +
    `Date ranges span at most ${MAX_RANGE_DAYS} days. ` +
    "Text search needs a year or a date range, and has limits worth knowing: words are matched as a phrase, next to each other, without regard to accents and with endings stemmed; nothing before 1992 is indexed; and the index is not complete, so a miss is not proof of absence. A hit comes with its matching passage, as the index holds it — lower case, no accents. " +
    "Results other than laws carry no title: get_gazette_text reads what an issue says.",
  inputSchema: {
    series: z.string().trim().min(1).max(20).optional().describe("Α, Β, Γ, Δ, Υ.Ο.Δ.Δ., Α.Σ.Ε.Π., Δ.Δ.Σ., ΠΡΑ.Δ.Ι.Τ. … Latin A, B, D are understood."),
    year: z.number().int().min(1833).max(2100).optional().describe("The issue year."),
    number: z.number().int().min(1).max(99_999).optional().describe("The issue number within its series and year, e.g. 6227 for ΦΕΚ Β 6227/2026."),
    text: z.string().trim().min(2).max(200).optional().describe("A word or phrase to find in the text, e.g. \"βραχυχρόνια μίσθωση\". Needs year or a date range."),
    issuedFrom: z.string().trim().optional().describe("Earliest date printed on the issue, YYYY-MM-DD."),
    issuedTo: z.string().trim().optional().describe("Latest date printed on the issue, YYYY-MM-DD."),
    releasedFrom: z.string().trim().optional().describe("Earliest release day, YYYY-MM-DD. Alone, that one day: what was published on it."),
    releasedTo: z.string().trim().optional().describe("Latest release day, YYYY-MM-DD."),
    limit: z.number().int().min(1).max(MAX_ISSUES).optional().describe(`Most issues, 1-${MAX_ISSUES}. Defaults to ${DEFAULT_ISSUES}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { series: "Α", year: 2026, text: "πυρκαγιές" },
  async handler(input, context) {
    const series = input.series === undefined ? undefined : resolveSeries(input.series);
    const issued = dateRange(input.issuedFrom, input.issuedTo, "issued");
    const released = dateRange(input.releasedFrom, input.releasedTo, "released");

    if (input.year === undefined && issued === undefined && released === undefined) {
      throw new InvalidInputError("Give a year or a date range: the whole gazette is too large to search at once.");
    }
    if (input.number !== undefined && series === undefined) {
      throw new InvalidInputError("An issue number only means something within a series: give series too (Α, Β, Δ…).");
    }

    const year = currentYear();
    const lastDay = [issued, released].filter(Boolean).map((range) => (range as string).slice(11)).sort().at(-1);
    const closed = lastDay !== undefined ? lastDay < new Date().toISOString().slice(0, 10) : (input.year ?? year) < year;

    const { hits, stemmedQuery } = await searchGazette(
      {
        years: input.year === undefined ? [] : [input.year],
        seriesIds: series === undefined ? [] : [series.id],
        number: input.number,
        text: input.text,
        issued,
        released,
      },
      context.cache,
      ttlFor(closed, context.ttl),
      context.signal,
    );

    const sorted = input.text
      ? [...hits].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      : [...hits].sort(
          (a, b) =>
            (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") ||
            a.seriesId - b.seriesId ||
            b.number - a.number,
        );

    const limit = input.limit ?? DEFAULT_ISSUES;
    const notes: string[] = [];
    if (input.text) {
      notes.push(
        `Searched as "${stemmedQuery ?? input.text}" after stemming. Words must stand next to each other, nothing before 1992 is indexed, and the index is not complete: a miss is not proof that no issue says it.`,
      );
      if (hits.length >= 1_500) notes.push("The search stops at 1,500 hits; narrow it by series or date to see the rest.");
    }
    if (sorted.length === 0 && !input.text) notes.push("No issue matches. Weekends and holidays have no releases.");
    if (sorted.length > limit) notes.push(`Showing ${limit} of ${sorted.length}. Raise limit, or narrow by series or date.`);

    return {
      total: sorted.length,
      truncated: sorted.length > limit,
      issues: sorted.slice(0, limit).map(({ seriesId: _seriesId, ...issue }) => issue),
      notes,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_gazette_issue                                                          */
/* -------------------------------------------------------------------------- */

/** An issue id, or a series, year and number resolved to one through the search. */
async function resolveIssueId(
  input: { id?: string | undefined; series?: string | undefined; year?: number | undefined; issue?: number | undefined },
  context: Parameters<typeof searchGazetteTool.handler>[1],
): Promise<string> {
  if (input.id !== undefined) {
    if (input.series !== undefined || input.issue !== undefined) {
      throw new InvalidInputError("Give id, or series, year and issue, not both.");
    }
    return input.id;
  }
  if (input.series === undefined || input.year === undefined || input.issue === undefined) {
    throw new InvalidInputError("Give the issue's id, or its series, year and issue number: ΦΕΚ Β 6227/2026 is series Β, year 2026, issue 6227.");
  }
  const series = resolveSeries(input.series);
  const { hits } = await searchGazette(
    { years: [input.year], seriesIds: [series.id], number: input.issue },
    context.cache,
    86_400,
    context.signal,
  );
  const hit = hits.find((entry) => entry.number === input.issue && entry.seriesId === series.id);
  if (!hit) throw new NotFoundError(`The gazette has no ΦΕΚ ${series.label} ${input.issue}/${input.year}.`);
  return hit.id;
}

export const getGazetteIssueTool = defineTool({
  name: "get_gazette_issue",
  title: "One ΦΕΚ issue and what changed it",
  description:
    "Everything the gazette records about one issue: its series, number and dates, who published it, the bodies it names, its subject tags — and its timeline both ways: the later acts that amended, extended, replaced or annulled it (`actedOnBy`), and the earlier acts it amends (`actsOn`). " +
    "This is how to tell whether a law still reads as published: law 4990/2022 has been amended by twenty-odd later acts. Each related act comes with its own id, so the chain can be followed. " +
    "Give the id that search_legislation or search_gazette returned, or the series, year and issue number.",
  inputSchema: {
    id: z.string().trim().regex(/^\d{1,9}$/u).optional().describe("The issue's id from a search result, e.g. \"627362\"."),
    series: z.string().trim().max(20).optional().describe("Series, with year and issue: Α, Β, Δ…"),
    year: z.number().int().min(1833).max(2100).optional().describe("Year, with series and issue."),
    issue: z.number().int().min(1).max(99_999).optional().describe("Issue number, with series and year."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { id: "627362" },
  async handler(input, context) {
    const id = await resolveIssueId(input, context);
    const issue = await fetchIssue(id, context.cache, context.ttl, context.signal);
    const { seriesId: _seriesId, ...rest } = issue;
    return {
      ...rest,
      notes: [
        ...(issue.actedOnBy.length > 0
          ? [`${issue.actedOnBy.length} later acts act on this issue, so its text as published may no longer be the law in force. Each is listed with its id.`]
          : []),
        "The timeline is the gazette's own linking of acts, and may be incomplete for older issues.",
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* get_gazette_text                                                           */
/* -------------------------------------------------------------------------- */

const MAX_TEXT_CHARACTERS = 40_000;
const DEFAULT_TEXT_PAGES = 10;
const MAX_TEXT_PAGES = 50;
/** Below this many characters a page, the PDF is a scan and the layer is noise. */
const SCANNED_THRESHOLD_PER_PAGE = 20;

export const getGazetteTextTool = defineTool({
  name: "get_gazette_text",
  title: "Read a ΦΕΚ issue",
  description:
    "The text of a ΦΕΚ issue — the law, the decree or the decision itself — page by page from its PDF. " +
    "Name it by its id, by series, year and issue number (ΦΕΚ Β 6227/2026), or, for a law or decree, by its own number and year (ν. 4990/2022 is lawNumber 4990, year 2022). A law's text is the whole issue that published it. " +
    `Text comes ${DEFAULT_TEXT_PAGES} pages at a time by default and never more than ${MAX_TEXT_CHARACTERS.toLocaleString("en-US")} characters per call; read \`nextPage\` to continue. ` +
    "Older issues are scanned images with no text layer: they come back empty with a note, and the PDF is at `pdfUrl`. Issues over 30 MB are not read here. " +
    "This is the text as published; get_gazette_issue says whether later acts have amended it.",
  inputSchema: {
    id: z.string().trim().regex(/^\d{1,9}$/u).optional().describe("The issue's id from a search result."),
    series: z.string().trim().max(20).optional().describe("Series, with year and issue: Α, Β, Δ…"),
    issue: z.number().int().min(1).max(99_999).optional().describe("Issue number, with series and year."),
    year: z.number().int().min(1833).max(2100).optional().describe("Year: of the issue, or of the act with lawNumber."),
    lawNumber: z.string().trim().min(1).max(10).optional().describe("A law's or decree's own number, with year."),
    kind: z.enum(KIND_NAMES).optional().describe("With lawNumber: law (default), presidential_decree, …"),
    fromPage: z.number().int().min(1).optional().describe("First page to return, 1-based. Defaults to 1."),
    maxPages: z.number().int().min(1).max(MAX_TEXT_PAGES).optional().describe(`Most pages to return, 1-${MAX_TEXT_PAGES}. Defaults to ${DEFAULT_TEXT_PAGES}.`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  example: { lawNumber: "4990", year: 2022, maxPages: 2 },
  async handler(input, context) {
    let target: { seriesId: number; year: number; number: number; label: string; id: string | null };

    if (input.lawNumber !== undefined) {
      if (input.year === undefined) throw new InvalidInputError("A law number needs its year: numbering restarted in different eras.");
      if (input.id !== undefined || input.series !== undefined || input.issue !== undefined) {
        throw new InvalidInputError("Give lawNumber and year, or an issue, not both.");
      }
      const acts = await searchLegislation(
        { kind: input.kind ?? "law", number: input.lawNumber, years: [input.year] },
        context.cache,
        86_400,
        context.signal,
      );
      const act = acts[0];
      if (!act || act.year === null) {
        throw new NotFoundError(`The gazette's index has no ${KINDS[input.kind ?? "law"].label} ${input.lawNumber}/${input.year}.`);
      }
      target = { seriesId: act.seriesId, year: act.year, number: act.number, label: act.label, id: act.id };
    } else if (input.id !== undefined) {
      const issue = await fetchIssue(input.id, context.cache, 21_600, context.signal);
      if (issue.year === null) throw new NotFoundError(`Issue ${input.id} has no date to find its PDF by.`);
      target = { seriesId: issue.seriesId, year: issue.year, number: issue.number, label: issue.label, id: issue.id };
    } else {
      if (input.series === undefined || input.year === undefined || input.issue === undefined) {
        throw new InvalidInputError(
          "Name the issue: its id; or series, year and issue (ΦΕΚ Β 6227/2026); or a law's lawNumber and year (ν. 4990/2022).",
        );
      }
      const series = resolveSeries(input.series);
      target = { seriesId: series.id, year: input.year, number: input.issue, label: `${series.label} ${input.issue}/${input.year}`, id: null };
    }

    const url = pdfUrl(target.seriesId, target.year, target.number);
    // The whole text is cached, so paging through a long issue costs one fetch.
    const text = await withCache<IssueText>(context.cache, cacheKey("et:text", url), context.ttl, async () =>
      extractText(await fetchPdf(url, context.signal), context.signal),
    );

    const fromPage = input.fromPage ?? 1;
    if (fromPage > text.pageCount) {
      throw new InvalidInputError(`fromPage (${fromPage}) is past the last page: the issue has ${text.pageCount}.`);
    }

    const pages: { page: number; text: string }[] = [];
    let characters = 0;
    let truncated = false;
    const wanted = Math.min(text.pageCount, fromPage - 1 + (input.maxPages ?? DEFAULT_TEXT_PAGES));
    for (let page = fromPage; page <= wanted; page += 1) {
      const body = text.pages[page - 1] ?? "";
      const room = MAX_TEXT_CHARACTERS - characters;
      if (body.length > room) {
        // Cut mid-page rather than drop it; `nextPage` re-reads the rest.
        if (room > 0) pages.push({ page, text: body.slice(0, room) });
        characters += Math.max(room, 0);
        truncated = true;
        break;
      }
      pages.push({ page, text: body });
      characters += body.length;
    }

    const lastReturned = pages.at(-1)?.page ?? fromPage;
    const nextPage = truncated ? lastReturned : lastReturned < text.pageCount ? lastReturned + 1 : null;
    const total = text.pages.reduce((sum, page) => sum + page.length, 0);
    const scanned = total < text.pageCount * SCANNED_THRESHOLD_PER_PAGE;

    return {
      gazette: target.label,
      id: target.id,
      pageCount: text.pageCount,
      fromPage,
      toPage: lastReturned,
      characters,
      truncated,
      nextPage,
      ...(scanned
        ? { note: "This issue has no text layer: it is a scanned image, so there is nothing to read here. The PDF itself is at pdfUrl." }
        : {}),
      pages,
      pdfUrl: url,
    };
  },
});

export const tools = [searchLegislationTool, searchGazetteTool, getGazetteIssueTool, getGazetteTextTool];
