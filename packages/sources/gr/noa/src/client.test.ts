import { InvalidInputError, UpstreamError } from "@agoramcp/core";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_WINDOW_DAYS, parseCatalogue, parseTime, resolveWindow } from "./client.ts";

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
  const header = "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType";

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
