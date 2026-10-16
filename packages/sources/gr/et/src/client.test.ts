import { createLogger, createMemoryCache, InvalidInputError, NotFoundError, type ToolContext } from "@agoramcp/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/**
 * A stand-in for the gazette's search backend and blob store, so nothing
 * here reaches the real services. The client captures `fetch` when its
 * module loads, so the stand-in goes in first and the client after it.
 */
let answer: (url: URL, init: RequestInit | undefined) => Response = () => envelope([]);
const asked: { url: URL; body: unknown; method: string }[] = [];

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  asked.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
  return answer(url, init);
};

/** The backend's way of answering: the payload as a JSON string inside JSON. */
function envelope(data: unknown): Response {
  return Response.json({ status: "ok", message: "Operation completed successfully", data: JSON.stringify(data) });
}

const { decodeSnippet, pdfUrl, resolveSeries, tidyText, usDate } = await import("./client.ts");
const { getGazetteTextTool, searchGazetteTool, searchLegislationTool } = await import("./tools.ts");

beforeEach(() => {
  answer = () => envelope([]);
  asked.length = 0;
});

function context(): ToolContext {
  return { cache: createMemoryCache(), logger: createLogger({ level: "error" }), ttl: 60, signal: new AbortController().signal, env: {} };
}

const law4990 = {
  search_ID: "627362",
  search_DocumentNumber: "210",
  search_IssueGroupID: "1",
  search_IssueDate: "11/11/2022 00:00:00",
  search_PublicationDate: "11/11/2022 00:00:00",
  search_Pages: "36",
  search_PrimaryLabel: "Α 210/2022",
  search_LawID: "1",
  search_LawProtocolNumber: "4990",
  search_Description: "ΠΡΟΣΤΑΣΙΑ ΠΡΟΣΩΠΩΝ ΠΟΥ ΑΝΑΦΕΡΟΥΝ ΠΑΡΑΒΙΑΣΕΙΣ ΕΝΩΣΙΑΚΟΥ ΔΙΚΑΙΟΥ",
};

describe("reading the backend", () => {
  test("every date is month first", () => {
    assert.equal(usDate("11/09/2022 00:00:00"), "2022-11-09");
    assert.equal(usDate(""), null);
  });

  test("series by label, Latin look-alike or id", () => {
    for (const given of ["Β", "B", "b", "ΦΕΚ Β", "2"]) assert.equal(resolveSeries(given).id, 2);
    assert.equal(resolveSeries("Υ.Ο.Δ.Δ.").id, 14);
    assert.equal(resolveSeries("d").id, 4);
    assert.throws(() => resolveSeries("Ω"), InvalidInputError);
  });

  test("the blob path pads series and number", () => {
    assert.equal(pdfUrl(1, 2022, 210), "https://ia37rg02wpsa01.blob.core.windows.net/fek/01/2022/20220100210.pdf");
    assert.equal(pdfUrl(14, 2026, 1), "https://ia37rg02wpsa01.blob.core.windows.net/fek/14/2026/20261400001.pdf");
  });

  test("snippets are base64, and the increment sign is read as Δ", () => {
    assert.equal(decodeSnippet(Buffer.from("δασικες  πυρκαγιες").toString("base64")), "δασικες πυρκαγιες");
    assert.equal(tidyText("ΕΦΗΜΕΡΙ∆Α   ΤΗΣ\n\n\n\nΚΥΒΕΡΝΗΣΕΩΣ "), "ΕΦΗΜΕΡΙΔΑ ΤΗΣ\n\nΚΥΒΕΡΝΗΣΕΩΣ");
  });
});

describe("search_legislation", () => {
  test("never asks without a year or a number, which runs to 50 MB", async () => {
    await assert.rejects(searchLegislationTool.handler({ kind: "royal_decree" }, context()), /too large to list/);
    await assert.rejects(searchLegislationTool.handler({ fromYear: 2000, toYear: 2020 }, context()), /at most 11 years/);
    assert.equal(asked.length, 0);
  });

  test("sends the catalogue, number and year, and reads the double-encoded answer", async () => {
    answer = () => envelope([law4990]);
    const result = (await searchLegislationTool.handler({ number: "4990", year: 2022, words: "παραβιάσεις" }, context())) as {
      acts: { id: string; number: string; gazette: { label: string }; issueDate: string; pdfUrl: string }[];
    };
    assert.deepEqual(asked[0]?.body, { legislationCatalogues: "1", legislationNumber: "4990", selectYear: ["2022"] });
    assert.equal(asked[0]?.method, "POST");
    assert.deepEqual(
      result.acts.map((act) => [act.id, act.number, act.gazette.label, act.issueDate]),
      [["627362", "4990", "Α 210/2022", "2022-11-11"]],
    );
  });
});

describe("search_gazette", () => {
  test("drops the stemmed query the backend slips into a text search", async () => {
    answer = () =>
      envelope([
        { ...law4990, search_Score: "1493", search_MatchedText: Buffer.from("πυρκαγιες μεγαλης εκτασης").toString("base64") },
        { search_stemmedQuery: "πυρκαγι" },
      ]);
    const result = (await searchGazetteTool.handler({ series: "A", year: 2022, text: "πυρκαγιές" }, context())) as {
      total: number;
      issues: { snippet: string; rank: number }[];
      notes: string[];
    };
    assert.equal(result.total, 1);
    assert.equal(result.issues[0]?.snippet, "πυρκαγιες μεγαλης εκτασης");
    assert.match(result.notes[0] ?? "", /"πυρκαγι"/);
  });

  test("refuses the searches that would scan the whole gazette", async () => {
    await assert.rejects(searchGazetteTool.handler({ text: "πυρκαγιές" }, context()), /year or a date range/);
    await assert.rejects(searchGazetteTool.handler({ year: 2026, number: 5 }, context()), /give series/);
    await assert.rejects(
      searchGazetteTool.handler({ releasedFrom: "2026-01-01", releasedTo: "2026-03-01" }, context()),
      /at most 31 days/,
    );
    assert.equal(asked.length, 0);
  });
});

describe("get_gazette_text", () => {
  test("refuses an issue too large before downloading it", async () => {
    answer = (url, init) => {
      if (url.host.endsWith("azurewebsites.net")) return envelope([law4990]);
      assert.equal(init?.method, "HEAD");
      return new Response(null, { headers: { "content-length": String(43_848_649) } });
    };
    await assert.rejects(getGazetteTextTool.handler({ lawNumber: "4990", year: 2022 }, context()), /42 MB, too large/);
    assert.equal(asked.filter((request) => request.method === "GET").length, 0);
  });

  test("a law not in the index is not_found", async () => {
    await assert.rejects(getGazetteTextTool.handler({ lawNumber: "99999", year: 2022 }, context()), NotFoundError);
  });
});
