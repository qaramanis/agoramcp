import { createLogger, createMemoryCache, InvalidInputError, NotFoundError, type ToolContext } from "@agoramcp/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/**
 * A stand-in for Eurostat, so nothing here reaches the real service. The
 * client captures `fetch` when its module loads, so the stand-in goes in
 * first and the client is imported after it.
 */
let answer: (url: URL) => Response = () => Response.json({});
const asked: URL[] = [];

globalThis.fetch = async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : input);
  asked.push(url);
  return answer(url);
};

const { decodeCube, describeDataset, parseCatalogue, periodYears } = await import("./client.ts");
const { getDataTool } = await import("./tools.ts");

beforeEach(() => {
  answer = () => Response.json({});
  asked.length = 0;
});

function context(): ToolContext {
  return { cache: createMemoryCache(), logger: createLogger({ level: "error" }), ttl: 60, signal: new AbortController().signal, env: {} };
}

/** Monthly unemployment for two countries, as a structure query and a data query return it. */
const dimension = {
  freq: { label: "Time frequency", category: { index: { M: 0 }, label: { M: "Monthly" } } },
  geo: { label: "Geopolitical entity", category: { index: { EL: 0, DE: 1 }, label: { EL: "Greece", DE: "Germany" } } },
};
const structure = {
  label: "Unemployment by sex and age - monthly data",
  id: ["freq", "geo", "time"],
  size: [1, 2, 0],
  dimension: { ...dimension, time: { category: { index: {} } } },
  value: {},
  extension: {
    description: "<p>Please note that this dataset is discontinued and replaced by dataset une_rt_m2.</p>",
    annotation: [
      { type: "OBS_PERIOD_OVERALL_LATEST", title: "2026-09" },
      { type: "DISSEMINATION_DOI_XML", title: "<skos:notation>10.2908/UNE_RT_M</skos:notation>" },
    ],
  },
};
// Germany has September, Greece not yet: index = geo * 3 + time.
const data = {
  label: structure.label,
  id: ["freq", "geo", "time"],
  size: [1, 2, 3],
  dimension: { ...dimension, time: { category: { index: { "2026-07": 0, "2026-08": 1, "2026-09": 2 } } } },
  value: { "0": 8.1, "1": 8.0, "3": 3.9, "4": 3.9, "5": 4.0 },
  status: { "1": "p", "2": "|C" },
  extension: { status: { label: { p: "provisional", "|C": "|confidential" } } },
};

describe("parseCatalogue", () => {
  test("reads the folder tree from indentation, and keeps a code once", () => {
    const toc = [
      '"title"\t"code"\t"type"\t"last update of data"\t"last table structure change"\t"data start"\t"data end"\t"values"',
      '"Database by themes"\t"data"\t"folder"\t" "\t" "\t" "\t" "\t',
      '"    Labour market"\t"labour"\t"folder"\t" "\t" "\t" "\t" "\t',
      '"        Unemployment by sex and age - monthly data"\t"une_rt_m"\t"dataset"\t"08.10.2026"\t"08.10.2026"\t"1983-01"\t"2026-09"\t757666',
      '"    Short-term indicators"\t"euroind"\t"folder"\t" "\t" "\t" "\t" "\t',
      '"        Unemployment by sex and age - monthly data"\t"une_rt_m"\t"dataset"\t"08.10.2026"\t"08.10.2026"\t"1983-01"\t"2026-09"\t757666',
    ].join("\n");
    assert.deepEqual(parseCatalogue(toc), [
      {
        code: "une_rt_m",
        title: "Unemployment by sex and age - monthly data",
        type: "dataset",
        path: ["Database by themes", "Labour market"],
        lastUpdate: "2026-10-08",
        dataStart: "1983-01",
        dataEnd: "2026-09",
        observations: 757666,
      },
    ]);
  });
});

describe("JSON-stat", () => {
  test("a structure answer describes the dataset, its DOI and its successor", () => {
    const info = describeDataset("UNE_RT_M", structure);
    assert.equal(info.code, "une_rt_m");
    assert.deepEqual(info.dimensions.map((d) => [d.id, d.codes.map((c) => c.code)]), [["freq", ["M"]], ["geo", ["EL", "DE"]]]);
    assert.equal(info.doi, "10.2908/UNE_RT_M");
    assert.equal(info.latestPeriod, "2026-09");
    assert.equal(info.discontinued, true);
    assert.equal(info.replacedBy, "une_rt_m2");
  });

  test("the flat index comes apart into codes, and a flag without a value is kept", () => {
    const cube = decodeCube(data);
    assert.deepEqual(
      cube.cells.map((cell) => [cell.codes.geo, cell.codes.time, cell.value, cell.flag]),
      [
        ["EL", "2026-07", 8.1, null],
        ["EL", "2026-08", 8.0, "p"],
        ["EL", "2026-09", null, "|C"],
        ["DE", "2026-07", 3.9, null],
        ["DE", "2026-08", 3.9, null],
        ["DE", "2026-09", 4.0, null],
      ],
    );
    assert.deepEqual(cube.flags, { p: "provisional", "|C": "|confidential" });
  });

  test("periods of every frequency count as years", () => {
    assert.equal(periodYears("2026"), 2026);
    assert.equal(periodYears("2026-Q3"), 2026.5);
    assert.equal(periodYears("2026-07"), 2026.5);
    assert.equal(periodYears("2026-S2"), 2026.5);
    assert.equal(periodYears("2026-13"), undefined);
  });
});

describe("get_data", () => {
  test("checks codes before asking, since upstream answers an unknown one with nothing", async () => {
    answer = () => Response.json(structure);
    await assert.rejects(getDataTool.handler({ dataset: "une_rt_m", geo: "GR" }, context()), /Greece as EL/);
    await assert.rejects(getDataTool.handler({ dataset: "une_rt_m", filters: "country=EL" }, context()), /no dimension "country"/);
    await assert.rejects(getDataTool.handler({ dataset: "une_rt_m", filters: "geo=XX" }, context()), InvalidInputError);
    await assert.rejects(
      getDataTool.handler({ dataset: "une_rt_m", startPeriod: "2026-01", lastPeriods: 2 }, context()),
      /not both/,
    );
    // Only the structure was asked for.
    assert.ok(asked.every((url) => url.searchParams.get("sinceTimePeriod") === "2999"));
  });

  test("each series keeps its own latest periods, Greece by default", async () => {
    answer = (url) => Response.json(url.searchParams.get("sinceTimePeriod") === "2999" ? structure : data);
    const result = (await getDataTool.handler({ dataset: "une_rt_m", lastPeriods: 1 }, context())) as {
      rows: Record<string, unknown>[];
      notes: string[];
      citation: string;
    };
    const query = asked.at(-1)?.searchParams;
    assert.deepEqual(query?.getAll("geo"), ["EL"]);
    // One period asked for, plus the monthly slack.
    assert.equal(query?.get("lastTimePeriod"), "7");
    assert.deepEqual(result.rows.map((row) => [row.geo, row.time, row.value, row.flag]), [
      ["EL", "2026-09", null, "|C"],
      ["DE", "2026-09", 4.0, null],
    ]);
    assert.match(result.citation, /doi\.org\/10\.2908\/UNE_RT_M/);
    assert.ok(result.notes.some((note) => /discontinued/.test(note)));
  });

  test("an unknown dataset is not_found", async () => {
    answer = () =>
      Response.json({ error: [{ status: 404, id: 100, label: "ERR_NOT_FOUND_4: NOPE is not available for dissemination." }] }, { status: 404 });
    await assert.rejects(getDataTool.handler({ dataset: "nope" }, context()), NotFoundError);
  });
});
