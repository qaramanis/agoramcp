import { createHash } from "node:crypto";

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
  /** What `approximateBytes` made of `value` when it was set. */
  bytes: number;
}

export interface MemoryCacheOptions {
  /** Oldest entries are evicted once the map grows past this. */
  maxEntries?: number;
  /**
   * Oldest entries are evicted once the values held add up to more than
   * this, by `approximateBytes`. A count alone does not bound memory: one
   * entry can be a 3 KB lookup or a whole 8 MB file.
   */
  maxBytes?: number;
}

/**
 * Single-process LRU with per-entry TTL, bounded by entry count and by size.
 * The Redis implementation lands in step 5 behind this same interface —
 * nothing above `Cache` should change.
 */
export function createMemoryCache(options: MemoryCacheOptions = {}): Cache {
  const maxEntries = options.maxEntries ?? 5_000;
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const store = new Map<string, Entry>();
  let heldBytes = 0;

  function remove(key: string): void {
    const entry = store.get(key);
    if (!entry) return;
    heldBytes -= entry.bytes;
    store.delete(key);
  }

  function evictIfNeeded(): void {
    while (store.size > maxEntries || heldBytes > maxBytes) {
      // Map iterates in insertion order, and `get` re-inserts, so the first
      // key is the least recently used.
      const oldest = store.keys().next();
      if (oldest.done) break;
      remove(oldest.value);
    }
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        remove(key);
        return undefined;
      }
      // Refresh recency.
      store.delete(key);
      store.set(key, entry);
      return entry.value as T;
    },

    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) return;
      remove(key);
      const bytes = approximateBytes(value);
      // Held, it would evict everything else and still not fit.
      if (bytes > maxBytes) return;
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000, bytes });
      heldBytes += bytes;
      evictIfNeeded();
    },

    async delete(key: string): Promise<void> {
      remove(key);
    },

    async clear(): Promise<void> {
      store.clear();
      heldBytes = 0;
    },
  };
}

/**
 * What holding a value costs, near enough to budget by: two bytes a
 * character, which is what V8 spends on any string with Greek in it, the
 * byte length of binary data, and a flat few bytes for everything else.
 * Walked with a stack rather than recursion, and each object once, so a
 * deep or shared structure costs no more to measure than to hold.
 */
function approximateBytes(value: unknown): number {
  let total = 0;
  const stack: unknown[] = [value];
  const seen = new Set<object>();

  while (stack.length > 0) {
    const item = stack.pop();

    if (typeof item === "string") {
      total += item.length * 2;
      continue;
    }
    if (item === null || typeof item !== "object") {
      total += 8;
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);

    total += 16;
    if (ArrayBuffer.isView(item)) {
      total += item.byteLength;
    } else if (Array.isArray(item)) {
      // Not `push(...item)`: a register's worth of rows would overflow the call's argument limit.
      for (const child of item) stack.push(child);
    } else if (item instanceof Map) {
      for (const [key, child] of item) stack.push(key, child);
    } else if (item instanceof Set) {
      for (const child of item) stack.push(child);
    } else {
      for (const [key, child] of Object.entries(item)) {
        total += key.length * 2;
        stack.push(child);
      }
    }
  }

  return total;
}

/**
 * Stable cache key. Object arguments are hashed with sorted keys so that
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` collapse to the same entry.
 */
export function cacheKey(namespace: string, input: unknown): string {
  const hash = createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 32);
  return `${namespace}:${hash}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Read-through cache. Concurrent misses on the same key share one upstream
 * call, so a burst of identical questions doesn't become a burst of requests.
 *
 * The shared call is the first caller's `load`, run on that caller's abort
 * signal. If that caller leaves, the load dies with it — which says nothing
 * about anyone waiting on it — so a waiter that sees it abort loads again,
 * as itself.
 */
export async function withCache<T>(
  cache: Cache,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;

  const pending = inFlight.get(key);
  if (pending) {
    try {
      return (await pending) as T;
    } catch (error) {
      if (isAbort(error)) return withCache(cache, key, ttlSeconds, load);
      throw error;
    }
  }

  const promise = (async () => {
    const value = await load();
    await cache.set(key, value, ttlSeconds);
    return value;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/** How `fetch`, `node:http` and a timer each report an aborted signal. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
