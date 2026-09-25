import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InvalidInputError, NotFoundError, UpstreamError, toolErrorMessage } from "./errors.ts";

describe("toolErrorMessage", () => {
  test("an AgoraError's message is written for the caller, and passes through", () => {
    assert.equal(toolErrorMessage(new NotFoundError("No decision.")), "No decision.");
  });

  test("a bug's own message stays on our side; the caller gets the request id", () => {
    const message = toolErrorMessage(new TypeError("Cannot read properties of undefined (reading 'info')"), "req-123");
    assert.doesNotMatch(message, /undefined|info/);
    assert.match(message, /req-123/);
  });
});

describe("the error vocabulary", () => {
  test("each class carries its code and status", () => {
    assert.deepEqual([new InvalidInputError("x").code, new InvalidInputError("x").status], ["invalid_input", 400]);
    assert.deepEqual([new NotFoundError("x").code, new NotFoundError("x").status], ["not_found", 404]);
  });

  test("an upstream 5xx is worth retrying and a 4xx is not", () => {
    assert.equal(new UpstreamError("x", { status: 503 }).retryable, true);
    assert.equal(new UpstreamError("x", { status: 404 }).retryable, false);
  });
});
