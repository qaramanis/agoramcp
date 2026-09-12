import { parseLogLevel, type LogLevel } from "@agoramcp/core";

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
  /** A successful tool call slower than this, in milliseconds, is logged as a warning. */
  slowToolMs: number;
  /** Whether a tool's arguments go on its log line. */
  logToolArgs: boolean;
  /** Where call outcomes are recorded for the status history. Unset: nowhere. */
  databaseUrl: string | undefined;
  /** `"*"` or an explicit allow-list of origins. */
  corsOrigins: "*" | string[];
  /** Requests per minute per client, per source. 0 disables the limiter. */
  rateLimitPerMinute: number;
  cacheMaxEntries: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const origins = (env.CORS_ORIGINS ?? "*").trim();

  return {
    host: env.HOST ?? "0.0.0.0",
    port: intFromEnv(env.PORT, 3000),
    logLevel: parseLogLevel(env.LOG_LEVEL, "info"),
    slowToolMs: intFromEnv(env.LOG_SLOW_TOOL_MS, 10_000),
    logToolArgs: boolFromEnv(env.LOG_TOOL_ARGS, true),
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    corsOrigins:
      origins === "*"
        ? "*"
        : origins
            .split(",")
            .map((origin) => origin.trim())
            .filter((origin) => origin !== ""),
    rateLimitPerMinute: intFromEnv(env.RATE_LIMIT_PER_MINUTE, 60),
    cacheMaxEntries: intFromEnv(env.CACHE_MAX_ENTRIES, 5_000),
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
