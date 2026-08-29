import { parseLogLevel, type LogLevel } from "@agoramcp/core";

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
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
