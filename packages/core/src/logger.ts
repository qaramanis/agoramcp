import { isAgoraError } from "./errors.ts";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export type LogFields = Record<string, unknown>;

/** One line before it is serialised, as `write` is handed it beside the JSON. */
export type LogEntry = LogFields & { time: string; level: Exclude<LogLevel, "silent">; message: string };

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
  /** Defaults to one JSON object per line on stdout. `entry` is the same line, unserialised. */
  write?: (line: string, entry: LogEntry) => void;
}

/**
 * An error as a line can carry it. An `AgoraError` is a failure a source
 * raised on purpose: its code, status and details say what happened, and a
 * stack would only say where the source chose to throw. Anything else is
 * unexpected, and there the stack is the one thing worth having. Either way
 * the cause is reduced to a sentence — enough to name the root, never a
 * second stack.
 */
function serialize(value: unknown): unknown {
  if (isAgoraError(value)) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
      status: value.status,
      retryable: value.retryable,
      details: value.details,
      cause: causeOf(value.cause),
    };
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, cause: causeOf(value.cause) };
  }
  return value;
}

function causeOf(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const threshold = LEVEL_RANK[level];

  function emit(entry: LogEntry["level"], message: string, fields?: LogFields): void {
    if (LEVEL_RANK[entry] < threshold) return;
    const payload: LogEntry = {
      time: new Date().toISOString(),
      level: entry,
      message,
      ...base,
    };
    if (fields) {
      for (const [key, value] of Object.entries(fields)) payload[key] = serialize(value);
    }
    write(JSON.stringify(payload), payload);
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
