import { createLogger, createMemoryCache, InvalidInputError, NotFoundError, type ToolContext } from "@agoramcp/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/**
 * A stand-in for the ECB, so nothing here reaches the real service. The
 * client captures `fetch` when its module loads, so the stand-in goes in
 * first and the client is imported after it.
 */
let answer: (url: URL) => Response = () => new Response("", { status: 200 });
const asked: URL[] = [];

globalThis.fetch = async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : input);
  asked.push(url);
  return answer(url);
};

const { checkPeriods, decodeMessage, fetchData, isStale, normalizeKey, parseDataflows, parseDimensions, periodBounds } =
  await import("./client.ts");
const { getExchangeRateTool } = await import("./tools.ts");

beforeEach(() => {
  answer = () => new Response("", { status: 200 });
  asked.length = 0;
});

const signal = new AbortController().signal;

function context(): ToolContext {
  return { cache: createMemoryCache(), logger: createLogger({ level: "error" }), ttl: 60, signal, env: {} };
}

/** Two days of the dollar, shaped as the API sends them. */
const usd = {
  dataSets: [
    {
      series: {
        "0:0:0:0:0": {
          attributes: [0, null, 0],
          observations: { "0": [1.1206, 0, null], "1": [null, 1, 0] },
        },
      },
    },
  ],
  structure: {
    dimensions: {
      series: [
        { id: "FREQ", values: [{ id: "D", name: "Daily" }] },
        { id: "CURRENCY", values: [{ id: "USD", name: "US dollar" }] },
        { id: "CURRENCY_DENOM", values: [{ id: "EUR", name: "Euro" }] },
        { id: "EXR_TYPE", values: [{ id: "SP00", name: "Spot" }] },
        { id: "EXR_SUFFIX", values: [{ id: "A", name: "Average" }] },
      ],
      observation: [{ id: "TIME_PERIOD", values: [{ id: "2026-10-09" }, { id: "2026-10-12" }] }],
    },
    attributes: {
      series: [
        { id: "TITLE", values: [{ name: "US dollar/Euro ECB reference exchange rate" }] },
        { id: "BREAKS", values: [] },
        { id: "UNIT", values: [{ id: "USD", name: "US dollar" }] },
      ],
      observation: [
        { id: "OBS_STATUS", values: [{ id: "A", name: "Normal value" }, { id: "Q", name: "Missing value; suppressed" }] },
        { id: "OBS_COM", values: [{ name: "Indicative rate" }] },
      ],
    },
  },
};

describe("periods", () => {
  test("every SDMX period format has bounds", () => {
    const iso = (period: string) => {
      const bounds = periodBounds(period);
      return bounds && [bounds.start.toISOString().slice(0, 10), bounds.end.toISOString().slice(0, 10)];
    };
    assert.deepEqual(iso("2024"), ["2024-01-01", "2024-12-31"]);
    assert.deepEqual(iso("2024-S2"), ["2024-07-01", "2024-12-31"]);
    assert.deepEqual(iso("2024-Q1"), ["2024-01-01", "2024-03-31"]);
    assert.deepEqual(iso("2024-02"), ["2024-02-01", "2024-02-29"]);
    assert.deepEqual(iso("2026-W41"), ["2026-10-05", "2026-10-11"]);
    assert.deepEqual(iso("2026-10-14"), ["2026-10-14", "2026-10-14"]);
    assert.equal(periodBounds("2026-13"), undefined);
    assert.equal(periodBounds("2026-02-30"), undefined);
    assert.equal(periodBounds("yesterday"), undefined);
  });

  test("refuses what upstream answers with its 'access blocked' page", () => {
    const now = new Date("2026-10-15T18:00:00Z");
    assert.deepEqual(checkPeriods("2026-q2", undefined, now), { startPeriod: "2026-Q2", endPeriod: undefined });
    assert.throws(() => checkPeriods("2026-10-16", undefined, now), (error) => error instanceof InvalidInputError && /after today/.test(error.message));
    assert.throws(() => checkPeriods("2026-09", "2026-01", now), /after endPeriod/);
    assert.throws(() => checkPeriods("2026-13", undefined, now), /not a period/);
    // An end in the future is fine, and a start in a period that covers the end is not "after" it.
    assert.deepEqual(checkPeriods("2026-05", "2026", now), { startPeriod: "2026-05", endPeriod: "2026" });
    assert.doesNotThrow(() => checkPeriods(undefined, "2030", now));
  });
});

describe("normalizeKey", () => {
  const dimensions = ["FREQ", "CURRENCY", "CURRENCY_DENOM", "EXR_TYPE", "EXR_SUFFIX"].map((id, i) => ({ id, position: i + 1, codelist: null }));

  test("uppercases, keeps wildcards and OR", () => {
    assert.equal(normalizeKey("d.usd+gbp.eur..a", dimensions), "D.USD+GBP.EUR..A");
  });

  test("counts parts against the structure, and refuses the whole flow", () => {
    assert.throws(() => normalizeKey("D.USD", dimensions), /5 parts/);
    assert.throws(() => normalizeKey("....", dimensions), /every part empty/);
    assert.throws(() => normalizeKey("D.US D.EUR.SP00.A", dimensions), /not a series key/);
  });
});

describe("structure messages", () => {
  test("reads flows and the dimensions of a key, in key order", () => {
    const xml =
      '<str:Dataflows><str:Dataflow urn="x" agencyID="ECB" id="MIR" version="1.0"><com:Name xml:lang="en">MFI Interest Rate Statistics &amp; more</com:Name>' +
      '<str:Structure><Ref package="datastructure" agencyID="ECB" id="ECB_MIR1" version="1.0" class="DataStructure"/></str:Structure></str:Dataflow></str:Dataflows>' +
      '<str:DimensionList><str:Dimension urn="u" id="REF_AREA" position="2"><Ref agencyID="ECB" id="CL_AREA" class="Codelist"/></str:Dimension>' +
      '<str:Dimension urn="u" id="FREQ" position="1"><Ref agencyID="ECB" id="CL_FREQ" class="Codelist"/></str:Dimension>' +
      '<str:TimeDimension urn="u" id="TIME_PERIOD" position="3"></str:TimeDimension></str:DimensionList>';
    assert.deepEqual(parseDataflows(xml), [{ id: "MIR", agency: "ECB", name: "MFI Interest Rate Statistics & more", structure: "ECB_MIR1" }]);
    assert.deepEqual(parseDimensions(xml), [
      { id: "FREQ", position: 1, codelist: "CL_FREQ" },
      { id: "REF_AREA", position: 2, codelist: "CL_AREA" },
    ]);
  });
});

describe("decodeMessage", () => {
  test("undoes SDMX-JSON's positions into a named series", () => {
    const [series] = decodeMessage(usd);
    assert.ok(series);
    assert.equal(series.key, "D.USD.EUR.SP00.A");
    assert.deepEqual(series.dimensions.CURRENCY, { code: "USD", name: "US dollar" });
    assert.deepEqual(series.attributes.TITLE, { code: null, name: "US dollar/Euro ECB reference exchange rate" });
    assert.equal(series.attributes.BREAKS, undefined);
    assert.deepEqual(series.observations, [
      { period: "2026-10-09", value: 1.1206 },
      { period: "2026-10-12", value: null, status: { code: "Q", name: "Missing value; suppressed" }, comment: "Indicative rate" },
    ]);
  });

  test("a series that stopped reads as stale", () => {
    const [series] = decodeMessage(usd);
    assert.ok(series);
    assert.equal(isStale(series, new Date("2026-10-15T00:00:00Z")), false);
    assert.equal(isStale(series, new Date("2027-01-15T00:00:00Z")), true);
  });
});

describe("fetchData", () => {
  test("an empty 200 is a window with nothing in it, not a failure", async () => {
    const series = await fetchData({ flow: "EXR", key: "D.USD.EUR.SP00.A", startPeriod: "2026-10-11" }, createMemoryCache(), 60, signal);
    assert.deepEqual(series, []);
    assert.equal(asked[0]?.pathname, "/service/data/EXR/D.USD.EUR.SP00.A");
    assert.equal(asked[0]?.searchParams.get("format"), "jsondata");
  });

  test("no series is not_found, and the 'access blocked' 400 is the query's fault", async () => {
    answer = () => Response.json({ detail: "No Series was returned for the query" }, { status: 404 });
    await assert.rejects(fetchData({ flow: "EXR", key: "D.XXX.EUR.SP00.A" }, createMemoryCache(), 60, signal), NotFoundError);

    answer = () => new Response("<html>Your access has been blocked due to security concerns</html>", { status: 400 });
    await assert.rejects(fetchData({ flow: "EXR", key: "D.USD" }, createMemoryCache(), 60, signal), InvalidInputError);
  });
});

describe("get_exchange_rate", () => {
  test("a weekend date answers with the rate in force, and says so", async () => {
    // What upstream sends for the last observation up to Sunday: Friday's.
    const friday = structuredClone(usd);
    const [dataSet] = friday.dataSets;
    if (dataSet) dataSet.series["0:0:0:0:0"].observations = { "0": [1.1206, 0, null] } as never;
    answer = () => Response.json(friday);

    const result = (await getExchangeRateTool.handler({ currencies: "usd", date: "2026-10-11" }, context())) as {
      rates: { currency: string; date: string; rate: number }[];
      notes: string[];
    };
    assert.equal(asked[0]?.searchParams.get("endPeriod"), "2026-10-11");
    assert.equal(asked[0]?.searchParams.get("lastNObservations"), "1");
    assert.deepEqual(result.rates.map((rate) => [rate.currency, rate.date, rate.rate]), [["USD", "2026-10-09", 1.1206]]);
    assert.match(result.notes[0] ?? "", /No rate was set for USD on 2026-10-11/);
  });

  test("refuses the euro and a window that cannot be answered", async () => {
    await assert.rejects(getExchangeRateTool.handler({ currencies: "EUR" }, context()), /base/);
    await assert.rejects(getExchangeRateTool.handler({ date: "2026-10-01", startDate: "2026-09-01" }, context()), /not both/);
    await assert.rejects(getExchangeRateTool.handler({ startDate: "2020-01-01", endDate: "2026-01-01" }, context()), /most in one call/);
    assert.equal(asked.length, 0);
  });
});
