import { createLogger, createMemoryCache, InvalidInputError, type ToolContext } from "@agoramcp/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/**
 * A stand-in for admie.gr, so nothing here reaches the real site. The client
 * captures `fetch` when its module loads, so the stand-in goes in first.
 */
let answer: (url: URL) => Response = () => Response.json([]);
const asked: URL[] = [];
globalThis.fetch = async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : input);
  asked.push(url);
  return answer(url);
};

const { checkFileUrl, dottedDate, hoursInDay, latestVersions, parseForecast, parseRealisation, toFile } = await import("./client.ts");
const { listFilesTool } = await import("./tools.ts");

beforeEach(() => {
  answer = () => Response.json([]);
  asked.length = 0;
});

function context(): ToolContext {
  return { cache: createMemoryCache(), logger: createLogger({ level: "error" }), ttl: 60, signal: new AbortController().signal, env: {} };
}

const base = "https://www.admie.gr/sites/default/files/attached-files/type-file/2026/10/";

describe("files", () => {
  test("dates are day first, and a file's version is its upload counter", () => {
    assert.equal(dottedDate("14.10.2026"), "2026-10-14");
    assert.equal(dottedDate("15.10.2026 06:05"), "2026-10-15T06:05");
    const file = toFile({
      file_path: `${base}20261014_ISP1DayAheadLoadForecast_02.xlsx`,
      file_fromdate: "14.10.2026",
      file_todate: "14.10.2026",
      file_published: "13.10.2026 13:25",
    });
    assert.deepEqual([file?.version, file?.format, file?.coverageFrom], [2, "xlsx", "2026-10-14"]);
  });

  test("only the latest version of each day is kept", () => {
    const file = (name: string, day: string) => toFile({ file_path: `${base}${name}`, file_fromdate: day, file_todate: day });
    const kept = latestVersions(
      [file("20261014_X_01.xls", "14.10.2026"), file("20261014_X_02.xls", "14.10.2026"), file("20261013_X_01.xls", "13.10.2026")].filter(
        (entry) => entry !== null,
      ),
    );
    assert.deepEqual(kept.map((entry) => entry.fileName), ["20261014_X_02.xls", "20261013_X_01.xls"]);
  });

  test("reads only ΑΔΜΗΕ's own workbooks", () => {
    assert.equal(checkFileUrl(`${base}20261014_X_01.xls`), `${base}20261014_X_01.xls`);
    assert.throws(() => checkFileUrl("https://example.com/x.xls"), InvalidInputError);
    assert.throws(() => checkFileUrl(`${base}20261231_UnitsMaintenanceSchedule.pdf`), /Only \.xls and \.xlsx/);
  });

  test("a mistyped type is refused before the listing, which would answer it with nothing", async () => {
    answer = (url) => Response.json(url.pathname === "/getFiletypeInfo" ? [{ filetype: "SystemRealizationSCADA", EN: [{}], GR: [{}] }] : []);
    await assert.rejects(listFilesTool.handler({ fileType: "SystemRealisationSCADA" }, context()), /not one of ΑΔΜΗΕ's file types/);
    assert.deepEqual(asked.map((url) => url.pathname), ["/getFiletypeInfo"]);
  });
});

describe("the calendar", () => {
  test("a Greek day is 23 hours in spring, 25 in autumn", () => {
    assert.equal(hoursInDay("2026-03-29"), 23);
    assert.equal(hoursInDay("2026-10-25"), 25);
    assert.equal(hoursInDay("2026-10-14"), 24);
  });
});

describe("parseRealisation", () => {
  test("finds rows by any of their labels, sums by the SUM column, and keeps the day's hours", () => {
    const hours = Array.from({ length: 25 }, (_, i) => String(i + 1).padStart(2, "0"));
    const row = (label: string, value: number) => [null, label, ...Array.from({ length: 25 }, () => value), value * 24];
    const realisation = parseRealisation(
      {
        sheets: [
          { name: "XDO_METADATA", rows: [["x"]] },
          {
            name: "System_Production",
            rows: [[null, "(ΣΤΟΙΧΕΙΑ SCADA ΜΗ-ΠΙΣΤΟΠΟΙΗΜΕΝΑ)"], [null, null, ...hours, "SUM"], row("ΚΑΘΑΡΟ ΦΟΡΤΙΟ", 5000), row("ΣΥΝΟΛΟ Φ.ΑΕΡΙΟΥ", 2000), row("ΣΥΝΟΛΟ ΑΙΟΛΙΚΩΝ", 400)],
          },
        ],
      },
      "2026-03-29",
    );
    assert.equal(realisation.hours, 23);
    assert.equal(realisation.rows.netLoad?.total, 120_000);
    assert.equal(realisation.rows.netLoad?.hourly.length, 23);
    assert.equal(realisation.rows.gas?.total, 48_000);
    assert.equal(realisation.rows.renewables?.label, "ΣΥΝΟΛΟ ΑΙΟΛΙΚΩΝ");
  });

  test("refuses a file with none of the load rows", () => {
    assert.throws(() => parseRealisation({ sheets: [{ name: "System_Production", rows: [[null, null, "01", "SUM"]] }] }, "2026-10-14"), /layout has changed/);
  });
});

describe("parseForecast", () => {
  test("reads values by the quarter-hour above them, across the blank column", () => {
    const header = [null, null, null, null, "1", "2", null, "3", "4"];
    const values = ["Load Forecast", "Load Forecast", "NA", "2026-10-14", 4210, 4160, null, 4110, 4090, ...Array.from({ length: 20 }, () => 1)];
    const { values: read } = parseForecast({ sheets: [{ name: "Sheet1", rows: [header, values] }] });
    assert.deepEqual(read, [4210, 4160, 4110, 4090]);
  });
});
