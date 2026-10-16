import {
  cacheKey,
  createHttpClient,
  readCapped,
  UpstreamError,
  withCache,
  type Cache,
} from "@agoramcp/core";
import { decode } from "jpeg-js";
import { AREAS, type FireRiskArea } from "./areas.ts";

/**
 * The fire-risk forecast exists only as a JPEG: one map a day, coloured by
 * category, posted on civilprotection.gov.gr. Its archive page lists each
 * map's image and the date it is valid for; the data is in the pixels.
 */
export const BASE_URL = "https://civilprotection.gov.gr/";

const site = createHttpClient({ baseUrl: BASE_URL, timeoutMs: 20_000, retries: 2 });

/** A map is 290–320 KB. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* The archive                                                                */
/* -------------------------------------------------------------------------- */

export interface FireRiskMap {
  /** The day the map is valid for, YYYY-MM-DD. */
  date: string;
  url: string;
}

/**
 * Maps from an archive page, newest first. A tile is
 * `<a href="/sites/default/files/2026-07/260801.jpg" class="maps_tile"
 * data-sub-html="01/08/2026">`: the folder is the upload month, not the
 * month the map is for — 1 August's map is in July's folder, and maps up to
 * 2022 have no folder at all — so URLs are read, never built.
 */
export function parseArchive(html: string): FireRiskMap[] {
  const maps: FireRiskMap[] = [];
  for (const match of html.matchAll(/<a\b[^>]*class="maps_tile"[^>]*>/gu)) {
    const tag = match[0];
    const href = /\shref="([^"]+\.jpe?g)"/iu.exec(tag)?.[1];
    const day = /\sdata-sub-html="(\d{2})\/(\d{2})\/(\d{4})"/u.exec(tag);
    if (!href || !day) continue;
    maps.push({ date: `${day[3]}-${day[2]}-${day[1]}`, url: new URL(href, BASE_URL).href });
  }
  return maps.sort((a, b) => b.date.localeCompare(a.date));
}

async function archivePage(query: Record<string, string | number>, cache: Cache, signal: AbortSignal): Promise<FireRiskMap[]> {
  return withCache(cache, cacheKey("civilprotection:archive", query), 600, async () => {
    const html = await site.getText("arxeio-imerision-xartwn", { query, signal, headers: { accept: "text/html" } });
    return parseArchive(html);
  });
}

/** The newest maps, eight to an archive page. */
export async function latestMaps(count: number, cache: Cache, signal: AbortSignal): Promise<FireRiskMap[]> {
  const maps: FireRiskMap[] = [];
  for (let page = 0; maps.length < count && page < 10; page += 1) {
    const found = await archivePage({ page }, cache, signal);
    if (found.length === 0) break;
    maps.push(...found.filter((map) => !maps.some((held) => held.date === map.date)));
  }
  if (maps.length === 0) throw new UpstreamError("The civil protection archive listed no fire-risk maps.");
  return maps.slice(0, count);
}

/**
 * The map for one day, through the archive's date filter — which takes the
 * date month first, `08/13/2026`. A day with no map answers with a page and
 * no tiles.
 */
export async function mapFor(date: string, cache: Cache, signal: AbortSignal): Promise<FireRiskMap | null> {
  const [year, month, day] = date.split("-");
  const maps = await archivePage({ field_imerominia_harti_value: `${month}/${day}/${year}` }, cache, signal);
  return maps.find((map) => map.date === date) ?? null;
}

/* -------------------------------------------------------------------------- */
/* The template                                                               */
/* -------------------------------------------------------------------------- */

/** Every map since the 2023 season is drawn on this template; 2018–2022 maps are 830×872 on an older one. */
export const WIDTH = 1384;
export const HEIGHT = 1453;

export const CATEGORIES: Record<number, { label: string; labelEl: string }> = {
  1: { label: "low", labelEl: "Χαμηλή" },
  2: { label: "medium", labelEl: "Μέση" },
  3: { label: "high", labelEl: "Υψηλή" },
  4: { label: "very high", labelEl: "Πολύ υψηλή" },
  5: { label: "state of alert", labelEl: "Κατάσταση συναγερμού" },
};

/** Each category's swatch in the legend: x from 92 to 176, these rows. */
export const SWATCH_X: readonly [number, number] = [92, 176];
export const SWATCH_ROWS: Record<number, readonly [number, number]> = {
  1: [1291, 1305],
  2: [1311, 1326],
  3: [1332, 1347],
  4: [1354, 1369],
  5: [1375, 1390],
};
/** The legend as calibrated; a map whose swatches drift far from these is not this template. */
export const EXPECTED_LEGEND: Record<number, readonly [number, number, number]> = {
  1: [166, 255, 167],
  2: [166, 201, 238],
  3: [255, 255, 1],
  4: [255, 174, 0],
  5: [253, 0, 0],
};

/**
 * Points that are open sea, and points on the black forest-service borders,
 * on every 2023–2026 map checked. A shift of 2 px or more drops the border
 * count to 10 or fewer, so a moved or redrawn template is caught here
 * rather than read wrongly.
 */
export const SEA: readonly (readonly [number, number])[] = [
  [1211, 1000], [673, 337], [580, 525], [1033, 493], [715, 1088], [511, 1087], [551, 935], [1134, 996],
  [1340, 222], [778, 627], [1166, 479], [1189, 613], [1096, 672], [1146, 711], [1147, 472], [857, 1031],
];
export const BORDERS: readonly (readonly [number, number])[] = [
  [639, 337], [142, 497], [512, 711], [501, 684], [927, 847], [513, 649], [365, 354], [486, 686],
  [834, 289], [351, 674], [132, 512], [290, 847], [852, 973], [923, 1027], [534, 830], [1045, 1048],
  [557, 612], [553, 249], [566, 482], [612, 320], [687, 992], [131, 602], [840, 1056], [307, 423],
];

/** The box where the lightning advisory is printed, when it is. */
export const LIGHTNING_BOX = { x0: 870, y0: 360, x1: 1370, y1: 470 };

/** A pixel further than this from every legend colour is border, label or sea, not a category. */
const MAX_COLOUR_DISTANCE = 40;

/* -------------------------------------------------------------------------- */
/* Reading a map                                                              */
/* -------------------------------------------------------------------------- */

interface Image {
  data: Uint8Array;
  width: number;
}

const pixel = (image: Image, x: number, y: number): [number, number, number] => {
  const i = (y * image.width + x) * 3;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0];
};
const grey = (rgb: readonly number[]) => ((rgb[0] ?? 0) + (rgb[1] ?? 0) + (rgb[2] ?? 0)) / 3;
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

/** The legend as this very image draws it: the median of each swatch's interior, per channel. */
function readLegend(image: Image): [number, number, number][] {
  return [1, 2, 3, 4, 5].map((category) => {
    const [top, bottom] = SWATCH_ROWS[category] as readonly [number, number];
    const channels: [number[], number[], number[]] = [[], [], []];
    for (let y = top + 2; y <= bottom - 2; y += 1) {
      for (let x = SWATCH_X[0]; x <= SWATCH_X[1]; x += 1) {
        const rgb = pixel(image, x, y);
        channels.forEach((channel, i) => channel.push(rgb[i] ?? 0));
      }
    }
    return channels.map((channel) => channel.sort((a, b) => a - b)[channel.length >> 1] ?? 0) as [number, number, number];
  });
}

/** The category a pixel shows, or 0 where it is no category's colour. */
function categoryOf(rgb: readonly number[], legend: readonly (readonly number[])[]): number {
  let best = Infinity;
  let category = 0;
  legend.forEach((colour, index) => {
    const d = distance(rgb, colour);
    if (d < best) {
      best = d;
      category = index + 1;
    }
  });
  return best <= MAX_COLOUR_DISTANCE ? category : 0;
}

export interface AreaRisk {
  area: FireRiskArea;
  /** 1–5, or null where the area's pixels could not be read. */
  category: number | null;
}

export interface ReadMap {
  date: string;
  url: string;
  areas: AreaRisk[];
  lightningAdvisory: boolean;
}

/**
 * The template checks: size, sea where sea should be, borders where they
 * should be, and a legend in the calibrated colours. Any failure means the
 * map is not the template the areas were calibrated on, and reading it
 * would report confident, wrong categories.
 */
function checkTemplate(image: Image, height: number, legend: readonly (readonly number[])[]): void {
  if (image.width !== WIDTH || height !== HEIGHT) {
    throw new UpstreamError(
      `This map is ${image.width}×${height}, not the ${WIDTH}×${HEIGHT} template its areas were calibrated on, so it cannot be read. Maps before the 2023 season are on an older template; the image itself is at mapUrl.`,
    );
  }
  const seaOk = SEA.every(([x, y]) => grey(pixel(image, x, y)) >= 200);
  const borders = BORDERS.filter(([x, y]) => grey(pixel(image, x, y)) <= 110).length;
  const drift = [1, 2, 3, 4, 5].map((category, i) => distance(legend[i] ?? [], EXPECTED_LEGEND[category] ?? []));
  if (!seaOk || borders < 20 || drift.some((d) => d > 20)) {
    throw new UpstreamError(
      "This map does not match the template its areas were calibrated on (sea, borders or legend have moved), so its categories are not read rather than read wrongly. The image itself is at mapUrl.",
      { details: { borders, drift } },
    );
  }
}

/**
 * Every area's category: each sample disc's pixels go to the nearest legend
 * colour, those further than 40 from all of them are ignored, and the
 * majority wins — or the area is unreadable if under 60% of its pixels are
 * any category's colour.
 */
export function classify(data: Uint8Array, width: number, height: number, date: string, url: string): ReadMap {
  const image = { data, width };
  const legend = readLegend(image);
  checkTemplate(image, height, legend);

  const areas = AREAS.map((area) => {
    const counts = [0, 0, 0, 0, 0, 0];
    let total = 0;
    for (const [cx, cy, r] of area.samples) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dy * dy > r * r) continue;
          total += 1;
          const index = categoryOf(pixel(image, cx + dx, cy + dy), legend);
          counts[index] = (counts[index] ?? 0) + 1;
        }
      }
    }
    const read = total - (counts[0] ?? 0);
    if (read / Math.max(total, 1) < 0.6) return { area, category: null };
    let category = 1;
    for (let c = 2; c <= 5; c += 1) if ((counts[c] ?? 0) > (counts[category] ?? 0)) category = c;
    return { area, category };
  });

  const unreadable = areas.filter((entry) => entry.category === null).length;
  if (unreadable > 2) {
    throw new UpstreamError(`${unreadable} of the map's ${AREAS.length} areas could not be read, so none is reported. The image itself is at mapUrl.`);
  }

  let dark = 0;
  for (let y = LIGHTNING_BOX.y0; y <= LIGHTNING_BOX.y1; y += 1) {
    for (let x = LIGHTNING_BOX.x0; x <= LIGHTNING_BOX.x1; x += 1) if (grey(pixel(image, x, y)) < 100) dark += 1;
  }

  // The notice adds about 4,800 dark pixels to an otherwise empty box.
  return { date, url, areas, lightningAdvisory: dark > 2_000 };
}

async function fetchImage(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await site.request(url.slice(BASE_URL.length), { signal, headers: { accept: "image/jpeg" } });
  const bytes = await readCapped(response, MAX_IMAGE_BYTES);
  if (!bytes) throw new UpstreamError(`The map at ${url} is over ${MAX_IMAGE_BYTES / 1_048_576} MB.`, { status: 413 });
  return bytes;
}

function decodeMap(bytes: Uint8Array): { data: Uint8Array; width: number; height: number } {
  try {
    return decode(bytes, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 128, maxResolutionInMP: 4 });
  } catch (cause) {
    throw new UpstreamError("The map image could not be decoded.", { cause });
  }
}

/** A map's categories, cached rather than the 300 KB image: a published map never changes. */
export async function readMap(map: FireRiskMap, ttl: number, cache: Cache, signal: AbortSignal): Promise<ReadMap> {
  return withCache(cache, cacheKey("civilprotection:map", map.url), ttl, async () => {
    const { data, width, height } = decodeMap(await fetchImage(map.url, signal));
    return classify(data, width, height, map.date, map.url);
  });
}

/* -------------------------------------------------------------------------- */
/* A point on the map                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Longitude and latitude to a pixel of the template, by a cubic fitted on
 * the map's own projection (Greek Grid, EGSA87): with u = lon − 24 and
 * v = lat − 38, the terms are 1, u, v, u², uv, v², u³, u²v, uv², v³. Error
 * under a tenth of a pixel; a pixel is about 690 m.
 */
const TO_X = [601.214308929375, 127.9310589277682, -0.12913984002773637, -0.00046736944660208916, -1.7403135174038862, -3.116323012965502e-5, 0.0015288550317883484, -0.0003667054640331554, -0.019449780188091684, 4.428790350501871e-5];
const TO_Y = [794.4539501348712, -0.5995629510759461, -161.74844097926461, -0.6868966012816449, 0.007948535459241367, -0.010038396651432144, -0.00010216039630667649, -0.005769476146961177, 0.0005116569004816071, -2.875304821401265e-5];

export function toPixel(latitude: number, longitude: number): [number, number] {
  const u = longitude - 24;
  const v = latitude - 38;
  const terms = [1, u, v, u * u, u * v, v * v, u * u * u, u * u * v, u * v * v, v * v * v];
  const apply = (coefficients: readonly number[]) => terms.reduce((sum, term, i) => sum + term * (coefficients[i] ?? 0), 0);
  return [Math.round(apply(TO_X)), Math.round(apply(TO_Y))];
}

/** Inside Greece's frame on the map: outside it the fit is not valid. */
export function inFrame(latitude: number, longitude: number): boolean {
  return longitude >= 19.3 && longitude <= 29.7 && latitude >= 34.7 && latitude <= 41.8;
}

export interface PointRisk {
  category: number;
  area: FireRiskArea | null;
  /** How far the nearest coloured pixel was, where the point itself was a border, label or coastline. */
  offsetPx: number;
}

/**
 * The category at a point, and the area it lies in. The point's own pixel
 * may be a border line, a label or the coast, so the nearest coloured pixel
 * within 3 px is taken. The area is found by flooding outward through
 * pixels of the same colour — the black borders stop it — until the flood
 * reaches one of an area's sample points.
 */
export function riskAt(data: Uint8Array, width: number, height: number, x: number, y: number): PointRisk | null {
  const image = { data, width };
  const legend = readLegend(image);

  let start: [number, number] | null = null;
  let offset = 0;
  for (let radius = 0; radius <= 3 && start === null; radius += 1) {
    for (let dy = -radius; dy <= radius && start === null; dy += 1) {
      for (let dx = -radius; dx <= radius && start === null; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        if (categoryOf(pixel(image, px, py), legend) > 0) {
          start = [px, py];
          offset = radius;
        }
      }
    }
  }
  if (!start) return null;
  const category = categoryOf(pixel(image, start[0], start[1]), legend);

  // Every pixel of every sample disc names its area, so the flood stops at
  // the first one it meets.
  const owners = new Map<number, FireRiskArea>();
  for (const area of AREAS) {
    for (const [sx, sy, r] of area.samples) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) if (dx * dx + dy * dy <= r * r) owners.set((sy + dy) * width + sx + dx, area);
      }
    }
  }

  const seen = new Uint8Array(width * height);
  const queue = [start[1] * width + start[0]];
  seen[queue[0] as number] = 1;
  let area: FireRiskArea | null = null;
  for (let head = 0; head < queue.length && head < 400_000; head += 1) {
    const at = queue[head] as number;
    const owner = owners.get(at);
    if (owner) {
      area = owner;
      break;
    }
    const px = at % width;
    const py = (at - px) / width;
    for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (seen[next]) continue;
      seen[next] = 1;
      if (categoryOf(pixel(image, nx, ny), legend) === category) queue.push(next);
    }
  }

  return { category, area, offsetPx: offset };
}

export async function readPoint(
  map: FireRiskMap,
  latitude: number,
  longitude: number,
  cache: Cache,
  signal: AbortSignal,
): Promise<PointRisk | null> {
  const [x, y] = toPixel(latitude, longitude);
  return withCache(cache, cacheKey("civilprotection:point", { url: map.url, x, y }), 86_400, async () => {
    const { data, width, height } = decodeMap(await fetchImage(map.url, signal));
    checkTemplate({ data, width }, height, readLegend({ data, width }));
    return riskAt(data, width, height, x, y);
  });
}
