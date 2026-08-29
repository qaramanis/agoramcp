export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that stamps `fields` onto every line it writes. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Fields stamped onto every line, e.g. `{ source: "gr/diavgeia" }`. */
  base?: LogFields;
  /** Defaults to one JSON object per line on stdout. */
  write?: (line: string) => void;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const threshold = LEVEL_RANK[level];

  function emit(entry: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_RANK[entry] < threshold) return;
    const payload: LogFields = {
      time: new Date().toISOString(),
      level: entry,
      message,
      ...base,
    };
    if (fields) {
      for (const [key, value] of Object.entries(fields)) payload[key] = serialize(value);
    }
    write(JSON.stringify(payload));
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  if (value && value in LEVEL_RANK) return value as LogLevel;
  return fallback;
}
