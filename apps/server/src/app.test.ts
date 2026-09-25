import assert from "node:assert/strict";
import { describe, test } from "node:test";

/**
 * The server as a caller meets it, through `app.fetch` in memory: the MCP
 * mounts, the HTTP API and the limits in front of both. Nothing here reaches
 * a registry — each call is refused, or answered, before a handler would.
 *
 * The app reads its config at import, so the environment is set first. The
 * test runner gives each file its own process, so this stays here.
 */
process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_PER_MINUTE = "3";
process.env.REQUEST_HASH_SALT = "test-salt";
process.env.PROXY_SECRET = "test-proxy-secret";
delete process.env.DATABASE_URL;

const { default: app } = await import("./index.ts");
const { requesterId } = await import("@agoramcp/core");

let callers = 0;
/** Each test calls from an address of its own, so none spends another's budget. */
const newCaller = () => `198.51.100.${++callers}`;

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://server.test${path}`, {
      method: "POST",
      headers: { ...MCP_HEADERS, "x-forwarded-for": newCaller(), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function get(path: string, headers: Record<string, string> = {}, method = "GET") {
  return app.fetch(new Request(`http://server.test${path}`, { method, headers: { "x-forwarded-for": newCaller(), ...headers } }));
}

const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };

describe("the MCP mounts", () => {
  test("a source's own server lists its tools by their bare names", async () => {
    const response = await post("/gr/mcp/vies", listTools);
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    assert.deepEqual(body.result.tools.map((tool) => tool.name).sort(), ["check_vat_number", "list_member_states"]);
  });

  test("the country server prefixes each tool with its source", async () => {
    const response = await post("/gr/mcp", listTools);
    const names = ((await response.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name);
    assert.ok(names.includes("vies_check_vat_number"));
    assert.ok(names.includes("diavgeia_get_decision"));
  });

  test("a JSON-RPC batch is refused before the transport runs it", async () => {
    const response = await post("/gr/mcp/vies", [listTools, { ...listTools, id: 2 }]);
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error: { code: number } }).error.code, -32600);
  });

  test("a caller's mistake comes back as a tool error the model can read", async () => {
    const response = await post("/gr/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "diavgeia_search_decisions", arguments: { issuedFrom: "2026-02-01", issuedTo: "2026-01-01" } },
    });
    const result = ((await response.json()) as { result: { isError: boolean; content: { text: string }[] } }).result;
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /issuedFrom \(2026-02-01\) is after issuedTo \(2026-01-01\)/);
  });

  test("an unknown source is a 404", async () => {
    assert.equal((await post("/gr/mcp/nope", listTools)).status, 404);
    assert.equal((await post("/xx/mcp", listTools)).status, 404);
  });
});

describe("the HTTP API", () => {
  test("a malformed argument is a 400 naming the field", async () => {
    const response = await get("/gr/api/diavgeia/get_decision?ada=INVALID");
    const { error } = (await response.json()) as { error: { code: string; details: { issues: { path: string }[] } } };
    assert.equal(response.status, 400);
    assert.equal(error.code, "invalid_input");
    assert.equal(error.details.issues[0]?.path, "ada");
  });

  test("an undeclared, a repeated or an unparseable argument is a 400", async () => {
    const undeclared = await get("/gr/api/vies/list_member_states?nope=1");
    assert.match(((await undeclared.json()) as { error: { message: string } }).error.message, /nope/);
    assert.equal((await get("/gr/api/vies/check_vat_number?vatNumber=1&vatNumber=2")).status, 400);
    const notJson = await post("/gr/api/vies/check_vat_number", "{nope");
    assert.equal(notJson.status, 400);
  });

  test("a handler's own details are not sent, only its code and message", async () => {
    // NOA's window check puts requestedDays and maxDays in its details.
    const response = await get("/gr/api/noa/search_earthquakes?startTime=2026-01-01&endTime=2026-06-01");
    const { error } = (await response.json()) as { error: Record<string, unknown> };
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(error).sort(), ["code", "message", "retryable"]);
  });

  test("an unknown source or tool is a 404, and another verb a 405", async () => {
    assert.equal((await get("/gr/api/nope/tool")).status, 404);
    assert.equal((await get("/gr/api/vies/nope")).status, 404);
    const put = await get("/gr/api/vies/check_vat_number", {}, "PUT");
    assert.equal(put.status, 405);
    assert.equal(put.headers.get("allow"), "GET, POST");
  });
});

describe("limits", () => {
  const large = "a".repeat(70 * 1024);

  test("a body over 64 KB is refused on both doors", async () => {
    const mcp = await post("/gr/mcp/vies", { ...listTools, pad: large });
    assert.equal(mcp.status, 413);
    const api = await post("/gr/api/vies/check_vat_number", { vatNumber: large });
    assert.equal(api.status, 413);
    assert.equal(((await api.json()) as { error: { code: string } }).error.code, "payload_too_large");
  });

  test("the rate limit counts a requester, per source", async () => {
    const address = newCaller();
    const from = { "x-forwarded-for": address };
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await post("/gr/mcp/noa", listTools, from)).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
    // Another source is another budget.
    assert.equal((await post("/gr/mcp/vies", listTools, from)).status, 200);
  });

  test("the /live proxy's visitor shares the budget they spent directly", async () => {
    const address = newCaller();
    for (let i = 0; i < 3; i += 1) await post("/gr/mcp/noa", listTools, { "x-forwarded-for": address });
    const proxied = await post("/gr/mcp/noa", listTools, {
      "x-forwarded-for": "3.120.0.1",
      "x-agoramcp-proxy": "test-proxy-secret",
      "x-agoramcp-requester": requesterId(address, "test-salt"),
    });
    assert.equal(proxied.status, 429);
  });

  test("a requester named without the proxy's secret is ignored", async () => {
    const address = newCaller();
    for (let i = 0; i < 3; i += 1) await post("/gr/mcp/noa", listTools, { "x-forwarded-for": address });
    const forged = await post("/gr/mcp/noa", listTools, {
      "x-forwarded-for": address,
      "x-agoramcp-proxy": "a guess",
      "x-agoramcp-requester": requesterId("203.0.113.9", "test-salt"),
    });
    assert.equal(forged.status, 429);
  });
});

describe("request ids", () => {
  test("a caller's id is kept when it looks like one, and replaced when it does not", async () => {
    assert.equal((await get("/health", { "x-request-id": "fra1::abc-123.456" })).headers.get("x-request-id"), "fra1::abc-123.456");
    for (const strange of ["x".repeat(300), "hello world <script>"]) {
      const id = (await get("/health", { "x-request-id": strange })).headers.get("x-request-id");
      assert.match(id ?? "", /^[0-9a-f-]{36}$/);
    }
  });
});
