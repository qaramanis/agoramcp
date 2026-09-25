import { setTimeout as sleep } from "node:timers/promises";
import {
  RateLimitError,
  UpstreamError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
} from "./errors.ts";

export type QueryValue = string | number | boolean | Date | null | undefined;
export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export interface HttpClientOptions {
  /** Prefix for every request path. Trailing slash optional. */
  baseUrl: string;
  /** Identifies us to the upstream operator — always send something honest. */
  userAgent?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Additional attempts after the first, on retryable failures only. */
  retries?: number;
  /** Base delay for exponential backoff, in milliseconds. */
  retryBaseMs?: number;
  /** Ceiling for a single backoff wait, in milliseconds. */
  retryMaxDelayMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  query?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: RequestInit["body"];
}

export interface HttpClient {
  readonly baseUrl: string;
  /** Resolves a path + query against the base URL without making a request. */
  url(path: string, query?: QueryParams): URL;
  request(path: string, options?: RequestOptions): Promise<Response>;
  getJson<T>(path: string, options?: RequestOptions): Promise<T>;
  getText(path: string, options?: RequestOptions): Promise<string>;
}

export const DEFAULT_USER_AGENT =
  "agoramcp/0.1 (+https://github.com/qaramanis/agoramcp; open government data proxy)";

/** Statuses worth a second attempt. Everything else is a real answer. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    baseUrl,
    userAgent = DEFAULT_USER_AGENT,
    headers: baseHeaders = {},
    timeoutMs: defaultTimeoutMs = 15_000,
    retries: defaultRetries = 2,
    retryBaseMs = 300,
    retryMaxDelayMs = 5_000,
    fetch: fetchImpl = globalThis.fetch,
  } = options;

  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  function url(path: string, query?: QueryParams): URL {
    // A leading slash on `path` would discard the base URL's own path prefix.
    const target = new URL(path.replace(/^\/+/, ""), root);
    if (query) appendQuery(target.searchParams, query);
    return target;
  }

  async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
    const target = url(path, opts.query);
    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
    const attempts = (opts.retries ?? defaultRetries) + 1;

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      opts.signal?.throwIfAborted();

      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

      let response: Response;
      try {
        response = await fetchImpl(target, {
          method: opts.method ?? "GET",
          headers: {
            "user-agent": userAgent,
            accept: "application/json",
            ...baseHeaders,
            ...opts.headers,
          },
          ...(opts.body === undefined ? {} : { body: opts.body }),
          signal,
          redirect: "follow",
        });
      } catch (cause) {
        // The caller's own abort is not ours to retry or wrap.
        if (opts.signal?.aborted) throw cause;

        lastError = timeout.aborted
          ? new UpstreamTimeoutError(
              `${target.host} did not respond within ${timeoutMs}ms.`,
              { cause, details: { url: target.toString(), attempt } },
            )
          : new UpstreamUnavailableError(`Could not reach ${target.host}.`, {
              cause,
              details: { url: target.toString(), attempt },
            });

        if (attempt < attempts) {
          await backoff(attempt, retryBaseMs, retryMaxDelayMs, undefined, opts.signal);
          continue;
        }
        throw lastError;
      }

      if (response.ok) return response;

      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const shouldRetry = RETRYABLE_STATUS.has(response.status) && attempt < attempts;

      if (shouldRetry) {
        // Drain the body so the socket can be reused.
        await response.arrayBuffer().catch(() => undefined);
        await backoff(attempt, retryBaseMs, retryMaxDelayMs, retryAfter, opts.signal);
        continue;
      }

      throw await upstreamError(response, target, retryAfter);
    }

    // Unreachable: the loop either returns or throws on its final attempt.
    throw lastError ?? new UpstreamError(`Request to ${target.host} failed.`);
  }

  return {
    baseUrl: root,
    url,
    request,

    async getJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
      const response = await request(path, opts);
      const text = await response.text();
      // Every caller reads the answer straight away, so an empty one is
      // upstream's failure, not a TypeError two calls later.
      if (text.trim() === "") {
        throw new UpstreamError(`${new URL(response.url).host} answered with an empty body where JSON was expected.`, {
          status: response.status,
          details: { url: response.url },
        });
      }
      try {
        return JSON.parse(text) as T;
      } catch (cause) {
        throw new UpstreamError(
          `${new URL(response.url).host} returned a body that is not valid JSON.`,
          {
            cause,
            status: response.status,
            details: { url: response.url, preview: text.slice(0, 200) },
          },
        );
      }
    },

    async getText(path: string, opts: RequestOptions = {}): Promise<string> {
      const response = await request(path, opts);
      return response.text();
    },
  };
}

/**
 * A body read no further than `maxBytes`: the bytes, or `undefined` as soon
 * as the next chunk would pass the cap, and the rest is never downloaded.
 * `content-length` cannot be the whole check — a chunked answer has none,
 * and a compressed one declares its size before `fetch` inflates it.
 */
export async function readCapped(
  response: { body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function appendQuery(params: URLSearchParams, query: QueryParams): void {
  for (const [key, raw] of Object.entries(query)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      params.append(key, value instanceof Date ? value.toISOString() : String(value));
    }
  }
}

async function upstreamError(response: Response, target: URL, retryAfter: number | undefined) {
  const body = await response.text().catch(() => "");
  const details = {
    url: target.toString(),
    status: response.status,
    body: body.slice(0, 500),
  };

  if (response.status === 429) {
    return new RateLimitError(`${target.host} rate-limited this request.`, {
      details,
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    });
  }

  return new UpstreamError(
    `${target.host} responded ${response.status} ${response.statusText}.`.trim(),
    { status: response.status, details },
  );
}

/** Retry-After is either delay-seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, (date - Date.now()) / 1_000);
}

async function backoff(
  attempt: number,
  baseMs: number,
  maxMs: number,
  retryAfterSeconds: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  // Full jitter: spreads a thundering herd instead of re-synchronising it.
  const jittered = Math.random() * exponential;
  const wait =
    retryAfterSeconds === undefined ? jittered : Math.min(maxMs, retryAfterSeconds * 1_000);
  await sleep(wait, undefined, signal ? { signal } : undefined);
}
