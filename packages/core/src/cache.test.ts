import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { cacheKey, createMemoryCache, withCache } from "./cache.ts";
import { NotFoundError } from "./errors.ts";

describe("createMemoryCache", () => {
  afterEach(() => mock.timers.reset());

  test("evicts the least recently used past its entry count", async () => {
    const cache = createMemoryCache({ maxEntries: 2 });
    await cache.set("a", 1, 60);
    await cache.set("b", 2, 60);
    await cache.get("a"); // a is now more recent than b
    await cache.set("c", 3, 60);
    assert.equal(await cache.get("b"), undefined);
    assert.equal(await cache.get("a"), 1);
    assert.equal(await cache.get("c"), 3);
  });

  test("evicts by size once the values add up past the budget", async () => {
    const cache = createMemoryCache({ maxBytes: 1_000 });
    await cache.set("a", "x".repeat(300), 60); // ~600 bytes
    await cache.set("b", "y".repeat(300), 60);
    assert.equal(await cache.get("a"), undefined);
    assert.equal((await cache.get<string>("b"))?.length, 300);
  });

  test("does not hold a value larger than the whole budget", async () => {
    const cache = createMemoryCache({ maxBytes: 1_000 });
    await cache.set("small", "s", 60);
    await cache.set("huge", "z".repeat(600), 60);
    assert.equal(await cache.get("huge"), undefined);
    assert.equal(await cache.get("small"), "s");
  });

  test("replacing an entry gives back its bytes", async () => {
    const cache = createMemoryCache({ maxBytes: 1_000 });
    await cache.set("a", "x".repeat(400), 60);
    await cache.set("a", "short", 60);
    await cache.set("b", "y".repeat(400), 60);
    assert.equal(await cache.get("a"), "short");
    assert.ok(await cache.get("b"));
  });

  test("measures a register-sized array without overflowing the stack", async () => {
    const cache = createMemoryCache();
    const rows = Array.from({ length: 300_000 }, (_, id) => ({ id, name: `Οργανισμός ${id}` }));
    await cache.set("rows", rows, 60);
    assert.equal((await cache.get<unknown[]>("rows"))?.length, 300_000);
  });

  test("an entry expires with its TTL, and a TTL of zero is not held", async () => {
    mock.timers.enable({ apis: ["Date"], now: 0 });
    const cache = createMemoryCache();
    await cache.set("a", 1, 10);
    await cache.set("never", 1, 0);
    mock.timers.tick(9_999);
    assert.equal(await cache.get("a"), 1);
    mock.timers.tick(1);
    assert.equal(await cache.get("a"), undefined);
    assert.equal(await cache.get("never"), undefined);
  });
});

describe("cacheKey", () => {
  test("is the same whatever order the keys came in, and ignores undefined", () => {
    assert.equal(cacheKey("ns", { a: 1, b: [2, { c: 3 }] }), cacheKey("ns", { b: [2, { c: 3 }], a: 1, d: undefined }));
  });

  test("differs by namespace and by value", () => {
    assert.notEqual(cacheKey("one", { a: 1 }), cacheKey("two", { a: 1 }));
    assert.notEqual(cacheKey("ns", { a: 1 }), cacheKey("ns", { a: 2 }));
  });
});

describe("withCache", () => {
  const abort = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

  test("concurrent misses share one load, and the answer is kept", async () => {
    const cache = createMemoryCache();
    let loads = 0;
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "value";
    };
    const answers = await Promise.all([1, 2, 3].map(() => withCache(cache, "k", 60, load)));
    assert.deepEqual(answers, ["value", "value", "value"]);
    assert.equal(loads, 1);
    assert.equal(await cache.get("k"), "value");
  });

  test("a failure reaches every waiter and is not cached", async () => {
    const cache = createMemoryCache();
    let loads = 0;
    const failing = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new NotFoundError("no such thing");
    };
    const settled = await Promise.allSettled([withCache(cache, "n", 60, failing), withCache(cache, "n", 60, failing)]);
    assert.ok(settled.every((result) => result.status === "rejected" && result.reason instanceof NotFoundError));
    assert.equal(loads, 1);
    assert.equal(await cache.get("n"), undefined);
  });

  test("a waiter whose shared load was aborted by its starter loads again, as itself", async () => {
    const cache = createMemoryCache();
    const starter = withCache(cache, "k", 60, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw abort();
    });
    const waiter = withCache(cache, "k", 60, async () => "the waiter's own answer");
    await assert.rejects(starter, (error) => (error as Error).name === "AbortError");
    assert.equal(await waiter, "the waiter's own answer");
  });
});
