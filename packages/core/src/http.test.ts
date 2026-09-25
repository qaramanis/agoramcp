import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { RateLimitError, UpstreamError } from "./errors.ts";
import { createHttpClient, readCapped, type HttpClient } from "./http.ts";

/** A body delivered in `chunks` pieces of `size` bytes, as a server streaming it would. */
function streamed(chunks: number, size: number): { body: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) return controller.close();
      pulled += 1;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
  });
  return { body, pulled: () => pulled };
}

describe("readCapped", () => {
  test("returns a body under the cap whole", async () => {
    const bytes = await readCapped(new Response("a,b\n1,2\n"), 1_000);
    assert.equal(new TextDecoder().decode(bytes), "a,b\n1,2\n");
  });

  test("returns an empty array for no body", async () => {
    assert.deepEqual(await readCapped(new Response(null), 10), new Uint8Array(0));
  });

  test("stops at the cap without reading the rest", async () => {
    const source = streamed(1_000, 1_024);
    const bytes = await readCapped({ body: source.body }, 8 * 1_024);
    assert.equal(bytes, undefined);
    assert.ok(source.pulled() <= 10, `pulled ${source.pulled()} chunks after the cap`);
  });

  test("a body of exactly the cap is kept", async () => {
    const source = streamed(4, 256);
    const bytes = await readCapped({ body: source.body }, 1_024);
    assert.equal(bytes?.byteLength, 1_024);
  });
});

describe("createHttpClient", () => {
  let server: Server;
  let http: HttpClient;
  let hits: Record<string, number> = {};
  const routes: Record<string, (request: IncomingMessage, response: ServerResponse) => void> = {
    "/ok": (_request, response) => response.end(JSON.stringify({ answer: 42 })),
    "/echo": (request, response) => response.end(JSON.stringify({ url: request.url })),
    "/empty": (_request, response) => response.end(""),
    "/html": (_request, response) => response.end("<html>maintenance</html>"),
    "/missing": (_request, response) => {
      response.statusCode = 404;
      response.end("{}");
    },
    "/down": (_request, response) => {
      response.statusCode = 503;
      response.end("down");
    },
    "/limited": (_request, response) => {
      response.statusCode = 429;
      response.setHeader("retry-after", "7");
      response.end("slow down");
    },
    "/slow": (_request, response) => {
      setTimeout(() => response.end("{}"), 2_000);
    },
  };

  before(async () => {
    server = createServer((request, response) => {
      const path = (request.url ?? "").split("?")[0] ?? "";
      hits[path] = (hits[path] ?? 0) + 1;
      // The client under test has an /api/ base path; the routes are named without it.
      (routes[path.replace(/^\/api(?=\/)/u, "")] ?? routes["/missing"])!(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    // Backoff is kept short so the retry tests do not wait on it.
    http = createHttpClient({ baseUrl: `http://127.0.0.1:${port}/api/`, retries: 2, retryBaseMs: 1, retryMaxDelayMs: 5 });
  });
  beforeEach(() => {
    hits = {};
  });
  after(() => server.close());

  test("reads JSON", async () => {
    assert.deepEqual(await http.getJson("/ok"), { answer: 42 });
  });

  test("keeps the base path, appends the query and repeats arrays", async () => {
    const client = createHttpClient({ baseUrl: http.baseUrl.replace(/api\/$/u, "") });
    const body = await client.getJson<{ url: string }>("echo", {
      query: { q: "Αθήνα", tag: ["a", "b"], skip: undefined, at: new Date("2026-09-01T00:00:00Z") },
    });
    assert.equal(body.url, `/echo?q=${encodeURIComponent("Αθήνα")}&tag=a&tag=b&at=2026-09-01T00%3A00%3A00.000Z`);
  });

  test("an empty body is an upstream error, not undefined", async () => {
    await assert.rejects(http.getJson("/empty"), (error) => error instanceof UpstreamError && /empty body/.test(error.message));
  });

  test("a body that is not JSON is an upstream error with a preview", async () => {
    await assert.rejects(http.getJson("/html"), (error) => {
      assert.ok(error instanceof UpstreamError);
      assert.match(String(error.details?.preview), /maintenance/);
      return true;
    });
  });

  test("a 4xx is answered once, not retried", async () => {
    await assert.rejects(http.getJson("/missing"), (error) => {
      assert.ok(error instanceof UpstreamError);
      assert.equal(error.details?.status, 404);
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(hits["/api/missing"], 1);
  });

  test("a 5xx is retried, then reported as retryable", async () => {
    await assert.rejects(http.getJson("/down"), (error) => error instanceof UpstreamError && error.retryable);
    assert.equal(hits["/api/down"], 3);
  });

  test("a 429 becomes a RateLimitError carrying Retry-After", async () => {
    const client = createHttpClient({ baseUrl: http.baseUrl, retries: 0 });
    await assert.rejects(client.getJson("/limited"), (error) => error instanceof RateLimitError && error.retryAfterSeconds === 7);
  });

  test("the caller's abort passes through as an abort, unretried", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(http.getJson("/slow", { signal: controller.signal }), (error) => (error as Error).name === "AbortError");
    assert.equal(hits["/api/slow"], 1);
  });

  test("its own timeout is an upstream_timeout", async () => {
    await assert.rejects(http.getJson("/slow", { timeoutMs: 50, retries: 0 }), (error) => (error as { code?: string }).code === "upstream_timeout");
  });
});
