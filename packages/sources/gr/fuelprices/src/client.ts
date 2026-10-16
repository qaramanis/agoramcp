import { setImmediate as nextTurn } from "node:timers/promises";
import {
  cacheKey,
  createHttpClient,
  NotFoundError,
  pageTexts,
  readCapped,
  UpstreamError,
  withCache,
  type Cache,
} from "@agoramcp/core";
import { getDocumentProxy } from "unpdf";
import { garbleFold, prefectureFromPrinted, type Prefecture } from "./prefectures.ts";

/**
 * fuelprices.gr: three listing pages of PDF bulletins, nothing else that is
 * open to a program. https only — plain http answers 301 — and every HTML
 * page is windows-1253 (the server says `Cp1253`), which `response.text()`
 * would read as mojibake.
 */
export const BASE_URL = "https://www.fuelprices.gr/";

const site = createHttpClient({ baseUrl: BASE_URL, timeoutMs: 20_000, retries: 2 });

/** The listing is 543 KB uncompressed (the server ignores gzip) and changes once a day. */
const LISTING_TTL = 3_600;
/** A published bulletin does not change: a re-upload goes to a new file name. */
const BULLETIN_TTL = 7 * 86_400;
/** The largest bulletin seen is a 1.6 MB weekly one. */
const MAX_PDF_BYTES = 5 * 1024 * 1024;

const cp1253 = new TextDecoder("windows-1253");

/* -------------------------------------------------------------------------- */
/* Listings                                                                   */
/* -------------------------------------------------------------------------- */

export type BulletinType = "daily" | "daily_national" | "weekly";

const LISTINGS: Record<BulletinType, { page: string; prefix: string }> = {
  daily: { page: "deltia_dn.view", prefix: "IMERISIO_DELTIO_ANA_NOMO" },
  daily_national: { page: "deltia_d.view", prefix: "IMERISIO_DELTIO_PANELLINIO" },
  weekly: { page: "deltia.view", prefix: "EBDOM_DELTIO" },
};

export interface Bulletin {
  /** The day the prices are for, YYYY-MM-DD; a Friday for the weekly. */
  date: string;
  url: string;
}

/**
 * Bulletins by date, newest first, from a listing page's links. The file
 * name carries the date, not always zero-padded (`6_11_2025` beside
 * `06_10_2026`), so it is read rather than built. Some dates also carry a
 * dead twin — `…25_09_2024 - ??????????.pdf`, `…09_06_2021 (2).pdf`, a name
 * with a trailing space — that answers with an HTML error page: the clean
 * name wins, and an odd one is kept only when it is all there is
 * (`EBDOM_DELTIO_05_01_2018..pdf` is the only link for that week, and works).
 */
export function parseListing(html: string, type: BulletinType): Bulletin[] {
  const { prefix } = LISTINGS[type];
  const clean = new RegExp(`^${prefix}_(\\d{1,2})_(\\d{1,2})_(\\d{4})\\.pdf$`, "u");
  const loose = new RegExp(`^${prefix}_(\\d{1,2})_(\\d{1,2})_(\\d{4})`, "u");
  const byDate = new Map<string, { name: string; clean: boolean }>();

  for (const match of html.matchAll(/href="\.?\/?files\/deltia\/([^"]+)"/gu)) {
    const name = match[1] ?? "";
    const parts = clean.exec(name) ?? loose.exec(name);
    if (!parts || !/\.pdf$/iu.test(name.trim().replace(/\.+pdf$/iu, ".pdf"))) continue;
    const [, day = "", month = "", year = ""] = parts;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const isClean = clean.test(name);
    const held = byDate.get(date);
    if (!held || (isClean && !held.clean)) byDate.set(date, { name, clean: isClean });
  }

  return [...byDate.entries()]
    .map(([date, { name }]) => ({ date, url: `${BASE_URL}files/deltia/${encodeURIComponent(name)}` }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchListing(type: BulletinType, cache: Cache, signal: AbortSignal): Promise<Bulletin[]> {
  return withCache(cache, cacheKey("fuelprices:listing", type), LISTING_TTL, async () => {
    const response = await site.request(LISTINGS[type].page, { signal, headers: { accept: "text/html" } });
    const html = cp1253.decode(new Uint8Array(await response.arrayBuffer()));
    const bulletins = parseListing(html, type);
    if (bulletins.length === 0) throw new UpstreamError(`fuelprices.gr listed no ${type} bulletins.`);
    return bulletins;
  });
}

/**
 * A bulletin's PDF. A file that does not exist is not a 404 here: the server
 * answers 200 with a small HTML page, so the type is what is checked.
 */
async function fetchPdf(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await site.request(url.slice(BASE_URL.length), { signal, headers: { accept: "application/pdf" } });
  if (!(response.headers.get("content-type") ?? "").includes("application/pdf")) {
    await response.body?.cancel().catch(() => undefined);
    throw new NotFoundError(`fuelprices.gr has no file at ${url}: it answers a missing bulletin with an error page.`, {
      details: { url },
    });
  }
  const bytes = await readCapped(response, MAX_PDF_BYTES);
  if (!bytes) throw new UpstreamError(`The bulletin at ${url} is over ${MAX_PDF_BYTES / 1_048_576} MB.`, { status: 413 });
  return bytes;
}

/* -------------------------------------------------------------------------- */
/* Daily bulletin by prefecture                                               */
/* -------------------------------------------------------------------------- */

export const FUELS = ["unleaded95", "unleaded100", "super", "diesel", "heating_oil", "autogas"] as const;
export type Fuel = (typeof FUELS)[number];

export const FUEL_NAMES: Record<Fuel, string> = {
  unleaded95: "Αμόλυβδη 95 οκτ.",
  unleaded100: "Αμόλυβδη 100 οκτ.",
  super: "Super",
  diesel: "Diesel κίνησης",
  heating_oil: "Diesel θέρμανσης κατ' οίκον",
  autogas: "Υγραέριο κίνησης (Autogas)",
};

export type Prices = Partial<Record<Fuel, number | null>>;

export interface DailyBulletin {
  date: string;
  url: string;
  /** The fuels this bulletin has a column for, left to right. */
  fuels: Fuel[];
  /** The bulletin's own national average, weighted by sales volume. */
  national: Prices;
  prefectures: { prefecture: Prefecture; prices: Prices }[];
}

export interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

/** Every text item with its position, a page at a time, stopping when the call does. */
export async function readItems(bytes: Uint8Array, signal: AbortSignal): Promise<Item[]> {
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const items: Item[] = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      signal.throwIfAborted();
      const content = await (await pdf.getPage(page)).getTextContent();
      for (const raw of content.items) {
        if (!("str" in raw) || typeof raw.str !== "string" || raw.str.trim() === "") continue;
        const transform = (raw as { transform?: number[] }).transform ?? [];
        items.push({
          str: raw.str.trim(),
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          width: (raw as { width?: number }).width ?? 0,
          page,
        });
      }
      await nextTurn();
    }
    return items;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Three decimals, or two where the PDF lost the last digit ("1,82" for 1,820 in one 2019 national row). */
const PRICE = /^\d,\d{2,3}$/u;

/**
 * The bulletin as rows. Its text stream is not in reading order — the 2017
 * files start at ΚΑΡΔΙΤΣΗΣ — so items are grouped by their baseline instead,
 * and a price the PDF split in two (`1,` and `917`, `1,70` and `4`, `0` and
 * `,859`) is put back together from fragments that touch.
 */
export function toRows(items: Item[]): Item[][] {
  const rows = new Map<string, Item[]>();
  for (const item of items) {
    const key = `${item.page}:${Math.round(item.y)}`;
    const row = rows.get(key);
    if (row) row.push(item);
    else rows.set(key, [item]);
  }

  return [...rows.values()]
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      const merged: Item[] = [];
      for (const [index, item] of row.entries()) {
        // Some 2017 rows are drawn twice over themselves; the copy would
        // otherwise be glued on as "1,5421,542".
        if (row.slice(0, index).some((other) => other.str === item.str && Math.abs(other.x - item.x) < 1)) continue;
        const previous = merged.at(-1);
        if (
          previous &&
          /[\d,]$/u.test(previous.str) &&
          /^[\d,]/u.test(item.str) &&
          item.x - (previous.x + previous.width) < 2
        ) {
          previous.str += item.str;
          previous.width = item.x + item.width - previous.x;
        } else {
          merged.push({ ...item });
        }
      }
      return merged;
    })
    .sort((a, b) => (a[0]?.page ?? 0) - (b[0]?.page ?? 0) || (b[0]?.y ?? 0) - (a[0]?.y ?? 0));
}

const centre = (item: Item) => item.x + item.width / 2;

/**
 * The fuel columns, found by their headers on the first page. The set and
 * order change between bulletins — Super until 2022, heating oil only from
 * 15 October to 30 April, and moved after autogas from 2022 — so nothing is
 * assumed: each column is wherever its header is, and a price belongs to the
 * nearest header. Two columns say "Diesel"; the word under each tells motor
 * diesel (Κίνησης) from heating oil (Θέρμανσης, κατ' οίκον).
 */
function findColumns(page: Item[]): { fuel: Fuel; x: number }[] {
  const columns: { fuel: Fuel; x: number }[] = [];

  // Header words arrive in pieces as often as whole — "Αμόλσβ" over "δη 95",
  // "Diese" and "l", "(Autoga" — so each is matched by the part that survives.
  for (const item of page) {
    if (/(^|\s)95(\s|$)/u.test(item.str)) columns.push({ fuel: "unleaded95", x: centre(item) });
    else if (/(^|\s)100(\s|$)/u.test(item.str)) columns.push({ fuel: "unleaded100", x: centre(item) });
    else if (/^super$/iu.test(item.str)) columns.push({ fuel: "super", x: centre(item) });
    else if (/autoga/iu.test(item.str)) columns.push({ fuel: "autogas", x: centre(item) });
    else if (/^diese/iu.test(item.str)) {
      const below = page.filter(
        (other) => other.y < item.y && item.y - other.y < 30 && Math.abs(centre(other) - centre(item)) < 20,
      );
      if (below.some((other) => /κ[ιί]νησ/iu.test(other.str))) columns.push({ fuel: "diesel", x: centre(item) });
      else if (below.some((other) => /^Θ|ο[ιί]κον/iu.test(other.str))) columns.push({ fuel: "heating_oil", x: centre(item) });
    }
  }

  // A header row repeats nothing, but guard against a second "95" in the notes.
  const seen = new Set<Fuel>();
  return columns
    .sort((a, b) => a.x - b.x)
    .filter((column) => (seen.has(column.fuel) ? false : (seen.add(column.fuel), true)));
}

/** "1,688" → 1.688; "0,000", which the 2019 bulletins print in an empty cell, → null. */
function price(text: string): number | null {
  const value = Number(text.replace(",", "."));
  return value > 0 ? value : null;
}

/**
 * The daily bulletin by prefecture, as data. A cell left blank is simply
 * missing from the text, which is why prices are placed by position rather
 * than counted off in order: `ΝΟΜΟΣ ΑΡΤΗΣ 1,533 1,713 1,288 …` in 2017 has
 * five prices for six columns, and only their x says which one is missing.
 */
export function parseDaily(items: Item[], date: string, url: string): DailyBulletin {
  // Each page that repeats the header is read by its own: a second page can
  // set its columns elsewhere. A page without one continues the last.
  const pages = Math.max(0, ...items.map((item) => item.page));
  const columnsByPage = new Map<number, { fuel: Fuel; x: number }[]>();
  let columns: { fuel: Fuel; x: number }[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const found = findColumns(items.filter((item) => item.page === page));
    if (found.length >= 3) columns = found;
    columnsByPage.set(page, columns);
  }
  columns = columnsByPage.get(1) ?? [];
  if (columns.length < 3) {
    throw new UpstreamError(`The bulletin for ${date} does not have the column headers this reader knows, so its prices cannot be placed.`, {
      details: { url },
    });
  }

  const national: Prices = {};
  const prefectures: DailyBulletin["prefectures"] = [];
  let previousLabel = "";

  for (const row of toRows(items)) {
    const prices = row.filter((item) => PRICE.test(item.str));
    // A dash marks an empty cell in the 2021–2022 bulletins; it is not part
    // of the name. Words also arrive cut in pieces — "ΝΟΜΟ Σ ΑΡΓΟΛΙΔΟΣ",
    // "Ν ΟΜΟΣ" — so names are compared with every space taken out.
    const label = row
      .filter((item) => !PRICE.test(item.str) && !/^[-–—]+$/u.test(item.str))
      .map((item) => item.str)
      .join(" ")
      .trim();
    if (prices.length === 0) {
      if (label) previousLabel = label;
      continue;
    }

    const values: Prices = {};
    const here = columnsByPage.get(row[0]?.page ?? 1) ?? columns;
    for (const item of prices) {
      const nearest = here.reduce((best, column) =>
        Math.abs(column.x - centre(item)) < Math.abs(best.x - centre(item)) ? column : best,
      );
      if (Math.abs(nearest.x - centre(item)) <= 25) values[nearest.fuel] = price(item.str);
    }

    const folded = garbleFold(label);
    // The national row's label can wrap: ΠΑΝΕΛΛΗΝΙΟΣ ΣΤΑΘΜΙΣΜΕΝΟΣ on one line
    // and Μ.Ο. on the next, with the prices beside the second or on a line
    // of their own between the two.
    const afterNational = /ΠΑΝ1ΛΛ/u.test(garbleFold(previousLabel));
    if (/ΠΑΝ1ΛΛ/u.test(folded) || ((label === "" || /^Μ\.?Ο\.?$/u.test(label)) && afterNational)) {
      Object.assign(national, values);
      continue;
    }

    // A long name can wrap, its prices beside the second line:
    // "ΝΟΜΟΣ ΑΙΤΩΛΙΑΣ ΚΑΙ" over "ΑΚΑΡΝΑΝΙΑΣ 1,645 …".
    const nameOf = (text: string) => {
      const name = /^ΝΟΜΟ[΢ΣC]?(.+)$/u.exec(text.replace(/\s+/gu, ""))?.[1];
      return name === undefined ? undefined : prefectureFromPrinted(name);
    };
    const prefecture = nameOf(label) ?? (/^ΝΟΜΟ/u.test(label) ? undefined : nameOf(`${previousLabel} ${label}`));
    if (prefecture) prefectures.push({ prefecture, prices: values });
    previousLabel = label;
  }

  if (prefectures.length < 40) {
    throw new UpstreamError(
      `Only ${prefectures.length} of the 51 prefectures could be read from the bulletin for ${date}; its layout is not one this reader knows.`,
      { details: { url } },
    );
  }

  return { date, url, fuels: columns.map((column) => column.fuel), national, prefectures };
}

export async function fetchDaily(bulletin: Bulletin, cache: Cache, signal: AbortSignal): Promise<DailyBulletin> {
  return withCache(cache, cacheKey("fuelprices:daily", bulletin.url), BULLETIN_TTL, async () => {
    const items = await readItems(await fetchPdf(bulletin.url, signal), signal);
    return parseDaily(items, bulletin.date, bulletin.url);
  });
}

/* -------------------------------------------------------------------------- */
/* Weekly bulletin                                                            */
/* -------------------------------------------------------------------------- */

export interface Breakdown {
  fuel: Fuel;
  /** Thursday's refinery price, €/litre before taxes. */
  refineryPrice: number | null;
  /** Taxes, duties and levies, €/litre. */
  taxes: number | null;
  /** Friday's national average retail price, €/litre. */
  retailPrice: number | null;
  /** The estimated margin of retailers and distributors, €/litre. */
  margin: number | null;
  shares: { refinery: number | null; taxes: number | null; margin: number | null };
  /** Whether refinery + taxes + margin come to the retail price, to half a cent. */
  consistent: boolean;
}

const number = (text: string | undefined): number | null => {
  if (text === undefined) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

function fuelOfHeading(heading: string): Fuel | null {
  if (/αμόλυβδη|αμολυβδη/iu.test(heading)) return "unleaded95";
  if (/θέρμανσης|θερμανσης/iu.test(heading)) return "heating_oil";
  if (/κίνησης|κινησης/iu.test(heading)) return "diesel";
  return null;
}

/**
 * How a litre's price is made up, per fuel, from the weekly bulletin's
 * "α. Διαμόρφωση τιμής" sections. These are hand-typed sentences: the verb
 * takes "στα", "στο" or nothing, the € sign comes and goes, and a sentence
 * can break across a page with a chart's labels in between. So each value
 * is found from its own anchor phrase, a missing one is null rather than a
 * guess, and the four are checked against each other — refinery price plus
 * taxes plus margin is the retail price, to the cent, in every bulletin read.
 */
export function parseBreakdowns(text: string): Breakdown[] {
  const out: Breakdown[] = [];
  const sections = [...text.matchAll(/(?:^|\n)\s*([2-5])\.\s*([^\n]+)\n\s*\1\.\s*α\.\s*Διαμόρφωση τιμής/gu)];

  sections.forEach((section, index) => {
    const fuel = fuelOfHeading(section[2] ?? "");
    if (!fuel) return;
    const start = section.index ?? 0;
    const endMarker = text.indexOf(`${section[1]}. β.`, start);
    const end = endMarker > start ? endMarker : (sections[index + 1]?.index ?? text.length);
    const body = text.slice(start, end);

    const after = (pattern: RegExp) => number(pattern.exec(body)?.[1]);
    const refineryPrice = after(/τιμή διυλιστηρίου[\s\S]{0,200}?διαμορφώθηκε\s*(?:στα|στο|σε)?\s*(\d+,\d+)/u);
    const taxes = after(/αντιστοιχούν σε\s*(\d+,\d+)/u);
    const retailPrice = after(/μέση τιμή λιανικής[\s\S]{0,600}?διαμορφώθηκε\s*(?:στα|στο|σε)?\s*(\d+,\d+)/u);
    const margin = after(/περιθώριο[\s\S]{0,200}?υπολογίζεται[\s\S]{0,60}?(\d+,\d+)/u);
    const sharesMatch =
      /διαμορφώνεται από την τιμή διυλιστηρίου κατά\s*(\d+,\d+)\s*%[\s\S]{0,200}?κατά\s*(\d+,\d+)\s*%[\s\S]{0,300}?κατά\s*(\d+,\d+)\s*%/u.exec(body);

    const parts = [refineryPrice, taxes, margin, retailPrice];
    const consistent =
      parts.every((part) => part !== null) &&
      Math.abs((refineryPrice ?? 0) + (taxes ?? 0) + (margin ?? 0) - (retailPrice ?? 0)) <= 0.005;

    out.push({
      fuel,
      refineryPrice,
      taxes,
      retailPrice,
      margin,
      shares: { refinery: number(sharesMatch?.[1]), taxes: number(sharesMatch?.[2]), margin: number(sharesMatch?.[3]) },
      consistent,
    });
  });

  return out;
}

export interface WeeklyBulletin {
  date: string;
  url: string;
  breakdowns: Breakdown[];
}

export async function fetchWeekly(bulletin: Bulletin, cache: Cache, signal: AbortSignal): Promise<WeeklyBulletin> {
  return withCache(cache, cacheKey("fuelprices:weekly", bulletin.url), BULLETIN_TTL, async () => {
    const bytes = await fetchPdf(bulletin.url, signal);
    const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
    let pages: string[];
    try {
      pages = await pageTexts(pdf, signal);
    } finally {
      await pdf.loadingTask.destroy();
    }
    const text = pages.join("\n").replace(/[ \t ]+/gu, " ").replace(/ ?\n ?/gu, "\n");
    return { date: bulletin.date, url: bulletin.url, breakdowns: parseBreakdowns(text) };
  });
}
