import {
  createLogger,
  createMemoryCache,
  InvalidInputError,
  NotFoundError,
  UpstreamError,
  UpstreamUnavailableError,
  type ToolContext,
} from "@agoramcp/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/**
 * A stand-in for the node, so nothing here reaches the real service. The
 * client captures `fetch` when its module loads, so the stand-in goes in
 * first and the client is imported after it. The test runner gives each file
 * its own process, so the swap stays in this file.
 */
const nothing = () => new Response(null, { status: 204 });
let answer: (query: URLSearchParams) => Response = nothing;
const asked: URLSearchParams[] = [];

globalThis.fetch = async (input: string | URL | Request) => {
  const { searchParams } = new URL(input instanceof Request ? input.url : input);
  asked.push(searchParams);
  return answer(searchParams);
};

const { MAX_WINDOW_DAYS, fetchQuake, parseCatalogue, parseTime, resolveWindow, searchQuakes } = await import("./client.ts");
const { listRecentEarthquakesTool } = await import("./tools.ts");

beforeEach(() => {
  answer = nothing;
  asked.length = 0;
});

const header = "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType";
const samos = "noa2020vipzs|2020-10-30T11:51:24.4|37.9001|26.8149|12|NOA|NOA|NOAIG|x|MLh|6.7|NOA|Aegean Sea|earthquake";

/** An answer in the `text` format, header first. */
const rows = (...lines: string[]) => new Response(`${header}\n${lines.join("\n")}\n`);

/** The client's own check: the hour of the Samos earthquake. */
const isProof = (query: URLSearchParams) => query.get("starttime") === "2020-10-30T11:00:00";

/** One closed day, as the tools would hand it over. */
const oneDay = (day: string) => ({
  window: resolveWindow(day, `${day}T23:59:59`, 1),
  orderBy: "time" as const,
  limit: 50,
});

const signal = new AbortController().signal;

describe("parseTime", () => {
  test("a bare date is the start of that day, and no zone means UTC", () => {
    assert.equal(parseTime("2026-09-01", "startTime").toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(parseTime("2026-09-01T14:30:00", "startTime").toISOString(), "2026-09-01T14:30:00.000Z");
    assert.equal(parseTime("2026-09-01T14:30:00+03:00", "startTime").toISOString(), "2026-09-01T11:30:00.000Z");
  });

  test("an unreadable time is the caller's, named by field", () => {
    assert.throws(() => parseTime("yesterday", "endTime"), (error) => error instanceof InvalidInputError && /endTime is not a time/.test(error.message));
  });
});

describe("resolveWindow", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  test("no bounds is the default number of days back from now", () => {
    const window = resolveWindow(undefined, undefined, 7, now);
    assert.equal(window.end.toISOString(), now.toISOString());
    assert.equal(window.days, 7);
  });

  test("refuses a window that ends before it starts", () => {
    assert.throws(() => resolveWindow("2026-09-10", "2026-09-01", 7, now), InvalidInputError);
  });

  test(`refuses a window longer than ${MAX_WINDOW_DAYS} days, which times the catalogue out`, () => {
    assert.throws(() => resolveWindow("2026-01-01", "2026-06-01", 7, now), (error) => {
      assert.ok(error instanceof InvalidInputError);
      assert.deepEqual(error.details, { requestedDays: 151, maxDays: MAX_WINDOW_DAYS });
      return true;
    });
    assert.equal(resolveWindow("2026-08-01", "2026-09-01", 7, now).days, 31);
  });
});

describe("parseCatalogue", () => {
  test("reads rows by column name, so a reordered header shifts nothing", () => {
    const row = "noa2026abcd|2026-09-01T10:00:00.12|38.12345|23.54321|10.44|NOA|NOA|NOA|x|ML|3.46|NOA|GREECE|earthquake";
    const [quake] = parseCatalogue(`${header}\n${row}\n`);
    assert.equal(quake?.id, "noa2026abcd");
    assert.deepEqual([quake?.latitude, quake?.longitude, quake?.depthKm, quake?.magnitude], [38.1235, 23.5432, 10.4, 3.5]);
    assert.equal(quake?.region, "GREECE");

    const reordered = "#Magnitude|EventID|Longitude|Latitude|Time\n3.46|noa2026abcd|23.54321|38.12345|2026-09-01T10:00:00";
    const [again] = parseCatalogue(reordered);
    assert.deepEqual([again?.id, again?.latitude, again?.magnitude], ["noa2026abcd", 38.1235, 3.5]);
  });

  test("an empty body is no events, and a row with no id or position is dropped", () => {
    assert.deepEqual(parseCatalogue(""), []);
    assert.deepEqual(parseCatalogue(`${header}\n|2026-09-01T10:00:00|38|23|||||||||||`), []);
  });

  test("rows without the header cannot be read by name, and are upstream's fault", () => {
    assert.throws(() => parseCatalogue("noa1|2026-09-01T10:00:00|38|23"), UpstreamError);
  });
});

describe("an empty search", () => {
  test("is the catalogue's silence when the Samos hour is empty too, and is not held", async () => {
    const cache = createMemoryCache();

    const result = await searchQuakes(oneDay("2026-09-27"), cache, 300, signal);
    assert.deepEqual([result.quakes, result.silent], [[], true]);
    assert.deepEqual(asked.map(isProof), [false, true]);

    // Asked again, the search goes back upstream; the verdict is held.
    await searchQuakes(oneDay("2026-09-27"), cache, 300, signal);
    assert.deepEqual(asked.map(isProof), [false, true, false]);
  });

  test("is a quiet window while the Samos hour still answers, and is held like any answer", async () => {
    answer = (query) => (isProof(query) ? rows(samos) : nothing());
    const cache = createMemoryCache();

    const result = await searchQuakes(oneDay("2026-09-27"), cache, 300, signal);
    assert.deepEqual([result.quakes, result.silent], [[], false]);

    await searchQuakes(oneDay("2026-09-27"), cache, 300, signal);
    assert.deepEqual(asked.map(isProof), [false, true]);
  });

  test("costs no check when it found something, or when it is before the catalogue opens", async () => {
    answer = (query) => (isProof(query) ? nothing() : rows(samos));
    const found = await searchQuakes(oneDay("2020-10-30"), createMemoryCache(), 300, signal);
    assert.deepEqual([found.quakes.length, found.silent], [1, false]);

    answer = nothing;
    const before = await searchQuakes(oneDay("2010-06-01"), createMemoryCache(), 300, signal);
    assert.equal(before.silent, false);

    assert.equal(asked.some(isProof), false);
  });

  test("stands as it came when the check itself fails", async () => {
    // `retry-after: 0`, so the client's one retry of a cheap window does not wait.
    answer = (query) => (isProof(query) ? new Response(null, { status: 503, headers: { "retry-after": "0" } }) : nothing());
    const result = await searchQuakes(oneDay("2026-09-27"), createMemoryCache(), 300, signal);
    assert.equal(result.silent, false);
  });
});

describe("a lookup that finds nothing", () => {
  test("is not_found while the catalogue answers, and unavailable while it is silent", async () => {
    answer = (query) => (isProof(query) ? rows(samos) : nothing());
    await assert.rejects(fetchQuake("noa2099zzzzz", createMemoryCache(), 1_800, signal), NotFoundError);

    answer = nothing;
    await assert.rejects(fetchQuake("noa2020vipzs", createMemoryCache(), 1_800, signal), (error) => {
      assert.ok(error instanceof UpstreamUnavailableError);
      assert.match(error.message, /cannot say whether "noa2020vipzs" exists/);
      return true;
    });
  });
});

describe("list_recent_earthquakes", () => {
  test("says the catalogue is silent in its notes, rather than reporting a quiet day", async () => {
    const context: ToolContext = {
      cache: createMemoryCache(),
      logger: createLogger({ level: "silent" }),
      ttl: 120,
      signal,
      env: {},
    };

    const result = (await listRecentEarthquakesTool.handler({}, context)) as { count: number; notes: string[] };
    assert.equal(result.count, 0);
    assert.match(result.notes[0] ?? "", /the catalogue's fault rather than a quiet period/);
  });
});
