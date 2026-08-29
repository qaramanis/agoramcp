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
}

export interface MemoryCacheOptions {
  /** Oldest entries are evicted once the map grows past this. */
  maxEntries?: number;
}

/**
 * Single-process LRU with per-entry TTL. The Redis implementation lands in
 * step 5 behind this same interface — nothing above `Cache` should change.
 */
export function createMemoryCache(options: MemoryCacheOptions = {}): Cache {
  const maxEntries = options.maxEntries ?? 5_000;
  const store = new Map<string, Entry>();

  function evictIfNeeded(): void {
    while (store.size > maxEntries) {
      // Map iterates in insertion order, and `get` re-inserts, so the first
      // key is the least recently used.
      const oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
    }
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      // Refresh recency.
      store.delete(key);
      store.set(key, entry);
      return entry.value as T;
    },

    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) return;
      store.delete(key);
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
      evictIfNeeded();
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async clear(): Promise<void> {
      store.clear();
    },
  };
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
  if (pending) return (await pending) as T;

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
