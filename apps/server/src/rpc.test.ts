import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calledToolName, summariseRpc } from "./rpc.ts";

describe("summariseRpc", () => {
  test("an initialize names the client and the protocol it asked for", () => {
    assert.deepEqual(
      summariseRpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.0" } },
      }),
      { method: "initialize", id: 1, client: { name: "claude-code", version: "2.1.0" }, protocolVersion: "2025-06-18" },
    );
  });

  test("a batch is its distinct methods and its length", () => {
    assert.deepEqual(summariseRpc([{ method: "tools/call" }, { method: "tools/call" }, { method: "tools/list" }]), {
      method: "tools/call,tools/list",
      batch: 3,
    });
  });

  test("anything it does not recognise is no summary", () => {
    assert.equal(summariseRpc(undefined), undefined);
    assert.equal(summariseRpc({ id: 1 }), undefined);
    assert.equal(summariseRpc([1, 2]), undefined);
  });
});

describe("calledToolName", () => {
  test("the name a tools/call asks for, and nothing for anything else", () => {
    assert.equal(calledToolName({ method: "tools/call", params: { name: "vies_check_vat_number" } }), "vies_check_vat_number");
    assert.equal(calledToolName({ method: "tools/list" }), undefined);
    assert.equal(calledToolName([{ method: "tools/call", params: { name: "x" } }]), undefined);
  });
});
