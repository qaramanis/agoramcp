import { NotFoundError, createLogger, createMemoryCache, defineSource, defineTool, type LogFields } from "@agoramcp/core";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import { callTool, type ToolDeps, type ToolCallRecord } from "./call.ts";

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
  tools: [lookup],
});

function run(vatNumber: string, toolArgs: boolean) {
  const lines: LogFields[] = [];
  const records: ToolCallRecord[] = [];
  const deps: ToolDeps = {
    cache: createMemoryCache(),
    logger: createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line) as LogFields) }),
    env: {},
    transport: "api",
    mount: "gr/test",
    requestId: "req-1",
    log: { slowToolMs: 10_000, toolArgs },
    record: (record) => records.push(record),
  };
  const call = callTool(source, lookup, { vatNumber }, deps, new AbortController().signal);
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
