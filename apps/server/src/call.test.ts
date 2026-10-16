import { NotFoundError, UpstreamTimeoutError, createLogger, createMemoryCache, defineSource, defineTool, withCache, type LogFields } from "@agoramcp/core";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import { callTool, writeOnlyCache, type ToolDeps, type ToolCallRecord } from "./call.ts";

/**
 * The privacy page promises that no argument is logged, so these pin down
 * what a tool line may carry either way `LOG_TOOL_ARGS` is set.
 */
const lookup = defineTool({
  name: "lookup",
  title: "Look up",
  description: "Test tool.",
  inputSchema: { vatNumber: z.string() },
  async handler(input) {
    if (input.vatNumber === "missing") {
      throw new NotFoundError(`No business registered under ${input.vatNumber}.`, { details: { url: `https://registry.test/vat/${input.vatNumber}` } });
    }
    return { name: "Example SA" };
  },
});

/** Waits until its signal aborts, as a handler stuck on a slow registry would. */
const stuck = defineTool({
  name: "stuck",
  title: "Stuck",
  description: "Test tool.",
  inputSchema: {},
  handler: (_input, context) =>
    new Promise((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    }),
});

const source = defineSource({
  id: "test",
  country: "gr",
  meta: {
    name: "Test",
    description: "Test source.",
    publisher: "Test",
    upstreamUrl: "https://registry.test",
    license: "CC-BY-4.0",
    attribution: "Test",
    ttl: { default: 0 },
  },
  tools: [lookup, stuck],
});

function deps(toolArgs: boolean, lines: LogFields[], records: ToolCallRecord[], deadlineMs = 10_000): ToolDeps {
  return {
    cache: createMemoryCache(),
    logger: createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line) as LogFields) }),
    env: {},
    deadlineMs,
    transport: "api",
    mount: "gr/test",
    requestId: "req-1",
    log: { slowToolMs: 10_000, toolArgs },
    record: (record) => records.push(record),
  };
}

function run(vatNumber: string, toolArgs: boolean) {
  const lines: LogFields[] = [];
  const records: ToolCallRecord[] = [];
  const call = callTool(source, lookup, { vatNumber }, deps(toolArgs, lines, records), new AbortController().signal);
  const outcome = (message: string) => lines.find((line) => line.message === message);
  return { call, lines, records, outcome };
}

describe("callTool", () => {
  test("by default a line carries the argument names, never their values", async () => {
    const r = run("094014201", false);
    await r.call;
    assert.deepEqual(r.outcome("tool.ok")?.argNames, ["vatNumber"]);
    assert.ok(!JSON.stringify(r.lines).includes("094014201"));
  });

  test("by default a failure keeps its kind but not the message or details that quote the arguments", async () => {
    const r = run("missing", false);
    await assert.rejects(r.call, NotFoundError);
    const failed = r.outcome("tool.failed");
    assert.deepEqual(failed?.error, { name: "NotFoundError", code: "not_found", status: 404, retryable: false });
    assert.ok(!JSON.stringify(r.lines).includes("registry.test/vat"));
  });

  test("with LOG_TOOL_ARGS on, the values and the whole error come back", async () => {
    const ok = run("094014201", true);
    await ok.call;
    assert.deepEqual(ok.outcome("tool.ok")?.args, { vatNumber: "094014201" });

    const failed = run("missing", true);
    await assert.rejects(failed.call);
    const error = failed.outcome("tool.failed")?.error as { message?: string; details?: { url?: string } };
    assert.match(error.message ?? "", /No business registered under missing/);
    assert.equal(error.details?.url, "https://registry.test/vat/missing");
  });

  test("the status history gets the outcome and timing, not the arguments", async () => {
    const r = run("missing", true);
    await assert.rejects(r.call);
    assert.equal(r.records.length, 1);
    assert.deepEqual(
      Object.keys(r.records[0]!).sort(),
      ["calledAt", "code", "durationMs", "ok", "requestId", "source", "tool", "transport"],
    );
    assert.deepEqual([r.records[0]!.ok, r.records[0]!.code], [false, "not_found"]);
  });
});

describe("the call's deadline", () => {
  test("a handler still working at the deadline is stopped and answered as upstream_timeout", async () => {
    const lines: LogFields[] = [];
    const records: ToolCallRecord[] = [];
    await assert.rejects(callTool(source, stuck, {}, deps(false, lines, records, 50), new AbortController().signal), (error) => {
      assert.ok(error instanceof UpstreamTimeoutError);
      assert.match(error.message, /did not answer within 0\.05 s/);
      return true;
    });
    assert.equal(lines.find((line) => line.message === "tool.failed")?.level, "warn");
    assert.deepEqual([records[0]?.ok, records[0]?.code], [false, "upstream_timeout"]);
  });

  test("a caller who leaves first is an abort, logged and not recorded", async () => {
    const lines: LogFields[] = [];
    const records: ToolCallRecord[] = [];
    const caller = new AbortController();
    setTimeout(() => caller.abort(), 20);
    await assert.rejects(callTool(source, stuck, {}, deps(false, lines, records, 10_000), caller.signal), (error) => (error as Error).name === "AbortError");
    assert.ok(lines.some((line) => line.message === "tool.aborted"));
    assert.equal(records.length, 0);
  });
});

describe("the monitor's proven check", () => {
  /** Counts how often it reaches its registry; a second call inside the TTL is answered from the cache. */
  let upstream = 0;
  const counted = defineTool({
    name: "counted",
    title: "Counted",
    description: "Test tool.",
    inputSchema: {},
    handler: (_input, context) => withCache(context.cache, "test:counted", 60, async () => ({ fetch: ++upstream })),
  });
  const cachedSource = defineSource({ ...source, tools: [counted] });

  test("reads nothing from the cache, so it reaches the registry, and leaves its answer for the next caller", async () => {
    const shared = createMemoryCache();
    const call = (cache: ToolDeps["cache"]) =>
      callTool(cachedSource, counted, {}, { ...deps(false, [], []), cache }, new AbortController().signal);

    assert.deepEqual(await call(shared), { fetch: 1 });
    // An ordinary call inside the TTL is the cached answer.
    assert.deepEqual(await call(shared), { fetch: 1 });
    // The check is not: it asks again.
    assert.deepEqual(await call(writeOnlyCache(shared)), { fetch: 2 });
    // And what it fetched is what the next caller gets.
    assert.deepEqual(await call(shared), { fetch: 2 });
  });
});
