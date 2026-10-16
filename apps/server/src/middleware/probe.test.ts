import { createLogger, PROBE_HEADER, PROXY_HEADER, type LogFields } from "@agoramcp/core";
import { Hono } from "hono";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { probeMode } from "./probe.ts";

/** An app that answers with what the middleware decided the request is. */
function app(secret: string | undefined, lines: LogFields[] = []) {
  const server = new Hono();
  server.use("*", async (c, next) => {
    c.set("logger", createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line) as LogFields) }));
    await next();
  });
  server.use("*", probeMode(secret));
  server.get("/", (c) => c.json({ probe: c.get("probe") ?? null }));
  return server;
}

async function decided(secret: string | undefined, headers: Record<string, string>, lines?: LogFields[]) {
  const response = await app(secret, lines).fetch(new Request("http://server.test/", { headers }));
  return ((await response.json()) as { probe: string | null }).probe;
}

describe("the monitor's mark", () => {
  test("an unmarked call is an ordinary one", async () => {
    assert.equal(await decided("s3cret", {}), null);
  });

  test("a mark with the web app's proof skips the cache", async () => {
    assert.equal(await decided("s3cret", { [PROBE_HEADER]: "1", [PROXY_HEADER]: "s3cret" }), "fresh");
  });

  test("a mark without the proof, where there is a secret, is ignored and noted", async () => {
    const lines: LogFields[] = [];
    assert.equal(await decided("s3cret", { [PROBE_HEADER]: "1", [PROXY_HEADER]: "guess" }, lines), null);
    assert.equal(await decided("s3cret", { [PROBE_HEADER]: "1" }, lines), null);
    assert.deepEqual(lines.map((line) => line.message), ["probe.unproven", "probe.unproven"]);
  });

  test("with no secret to check against, a mark is kept off the history but not trusted with the cache", async () => {
    assert.equal(await decided(undefined, { [PROBE_HEADER]: "1" }), "marked");
  });
});
