import { parseLogLevel, type LogLevel } from "@agoramcp/core";

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
  /** A successful tool call slower than this, in milliseconds, is logged as a warning. */
  slowToolMs: number;
  /** Whether a tool's argument values go on its log line; off, only their names. */
  logToolArgs: boolean;
  /** Where call outcomes are recorded for the status history. Unset: nowhere. */
  databaseUrl: string | undefined;
  /**
   * The key `requesterId` hashes addresses with — the web app's value, so a
   * person is one requester on both. Unset, the rate limiter keys on the
   * address itself.
   */
  requestHashSalt: string | undefined;
  /** What the web app's /live proxy presents to be trusted with its visitor's id. Unset, no one is. */
  proxySecret: string | undefined;
  /** `"*"` or an explicit allow-list of origins. */
  corsOrigins: "*" | string[];
  /** Requests per minute per client, per source. 0 disables the limiter. */
  rateLimitPerMinute: number;
  cacheMaxEntries: number;
  /** What the cache may hold before it evicts, in bytes. */
  cacheMaxBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const origins = (env.CORS_ORIGINS ?? "*").trim();

  return {
    host: env.HOST ?? "0.0.0.0",
    port: intFromEnv(env.PORT, 3000),
    logLevel: parseLogLevel(env.LOG_LEVEL, "info"),
    slowToolMs: intFromEnv(env.LOG_SLOW_TOOL_MS, 10_000),
    logToolArgs: boolFromEnv(env.LOG_TOOL_ARGS, false),
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    requestHashSalt: env.REQUEST_HASH_SALT?.trim() || undefined,
    proxySecret: env.PROXY_SECRET?.trim() || undefined,
    corsOrigins:
      origins === "*"
        ? "*"
        : origins
            .split(",")
            .map((origin) => origin.trim())
            .filter((origin) => origin !== ""),
    rateLimitPerMinute: intFromEnv(env.RATE_LIMIT_PER_MINUTE, 60),
    cacheMaxEntries: intFromEnv(env.CACHE_MAX_ENTRIES, 5_000),
    cacheMaxBytes: intFromEnv(env.CACHE_MAX_MB, 256) * 1024 * 1024,
  };
}

function intFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected a non-negative integer, got "${raw}".`);
  }
  return value;
}

function boolFromEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new Error(`Expected true or false, got "${raw}".`);
}
