import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import { fallsShort } from "./probe.ts";
import { defineSource, defineTool, probeFor, type Source } from "./source.ts";

const meta = {
  name: "Test",
  description: "A source for tests.",
  publisher: "Nobody",
  upstreamUrl: "https://example.org/",
  license: "CC0-1.0",
  attribution: "Nobody",
  ttl: { default: 60 },
};

const search = defineTool({
  name: "search",
  title: "Search",
  description: "Searches.",
  inputSchema: { query: z.string().min(2), limit: z.number().int().max(10).optional() },
  example: { query: "parks", limit: 5 },
  handler: async () => ({ count: 1 }),
});

const lookup = defineTool({
  name: "lookup",
  title: "Lookup",
  description: "Looks one up.",
  inputSchema: { ids: z.array(z.string()).optional() },
  example: { ids: ["a", "b"] },
  handler: async () => ({}),
});

const source = (probe?: Source["probe"], tools: Source["tools"] = [search]): Source =>
  ({ id: "test", country: "gr", meta, tools, ...(probe ? { probe } : {}) }) as Source;

describe("probeFor", () => {
  test("defaults to the first tool and its example", () => {
    assert.deepEqual(probeFor(source()), { tool: "search", input: { query: "parks", limit: 5 }, expect: null });
  });

  test("takes a declared tool, input and expectation", () => {
    const expect = { field: "count", atLeast: 1, detail: "Nothing came back." };
    assert.deepEqual(probeFor(source({ tool: "search", input: { query: "trees", limit: 1 }, expect })), {
      tool: "search",
      input: { query: "trees", limit: 1 },
      expect,
    });
  });

  test("refuses at boot what the monitor could not send", () => {
    assert.throws(() => defineSource(source({ tool: "missing" })), /not one of its tools/);
    assert.throws(() => defineSource(source({ tool: "search", input: { query: "x" } })), /does not satisfy the schema/);
    // A list cannot travel as one query-string value.
    assert.throws(() => defineSource(source({ tool: "lookup" }, [search, lookup])), /sends "ids" as a list/);
    assert.throws(
      () => defineSource(source({ tool: "search", expect: { field: "", atLeast: 1, detail: "x" } })),
      /without a field/,
    );
  });
});

describe("fallsShort", () => {
  const expect = (field: string, atLeast = 1) => ({ field, atLeast, detail: "x" });

  test("a number counts as it is, a list by its length, along a dotted path", () => {
    assert.equal(fallsShort({ count: 3 }, expect("count")), false);
    assert.equal(fallsShort({ count: 0 }, expect("count")), true);
    assert.equal(fallsShort({ result: { rows: [1, 2] } }, expect("result.rows", 2)), false);
    assert.equal(fallsShort({ result: { rows: [1] } }, expect("result.rows", 2)), true);
  });

  test("an answer without the expected shape falls short", () => {
    assert.equal(fallsShort({}, expect("count")), true);
    assert.equal(fallsShort({ count: "3" }, expect("count")), true);
    assert.equal(fallsShort(null, expect("count")), true);
    assert.equal(fallsShort({ result: 4 }, expect("result.rows")), true);
  });
});
