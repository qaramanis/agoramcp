import {
  MissingCredentialsError,
  UpstreamTimeoutError,
  isAgoraError,
  missingEnv,
  sourceKey,
  ttlFor,
  type AnySourceTool,
  type Cache,
  type ErrorCode,
  type LogFields,
  type Logger,
  type Source,
} from "@agoramcp/core";

/** How a call reached the server. */
export type Transport = "mcp" | "api";

/**
 * What every transport hands a tool, beyond the request itself: the shared
 * cache and env, and what this one request is — how and where it arrived,
 * under which id, and where its outcome should go once it is over.
 */
export interface ToolDeps {
  cache: Cache;
  /** Already carrying the request id, and stamped with `transport` and `mount`. */
  logger: Logger;
  env: Readonly<Partial<Record<string, string>>>;
  /**
   * How long one call may take from start to answer, in milliseconds. A
   * handler makes several upstream requests, each with its own timeout and
   * retries, so without a cap on the whole a slow registry could hold a call
   * for minutes after the caller's own client gave up at one.
   */
  deadlineMs: number;
  transport: Transport;
  /** The address the call arrived at: `gr` on the country server, `gr/vies` on the source's own. */
  mount: string;
  /** The `x-request-id` of the HTTP request this call belongs to. */
  requestId: string;
  log: CallLogOptions;
  /**
   * Where a finished call's outcome goes beyond the log — the status history.
   * Absent, it goes nowhere: the status probe's outcome is written by the
   * probe itself, and would otherwise be counted twice.
   */
  record?: (record: ToolCallRecord) => void;
}

export interface CallLogOptions {
  /** A successful call slower than this, in milliseconds, is logged as a warning. */
  slowToolMs: number;
  /**
   * Whether the validated arguments' values go on the line. Off, only their
   * names do: the privacy page promises arguments are not logged, and a VAT
   * number or a searched-for name is personal data.
   */
  toolArgs: boolean;
}

/** A finished call as the status history keeps it: outcome and timing, never arguments. */
export interface ToolCallRecord {
  calledAt: Date;
  source: string;
  tool: string;
  transport: Transport;
  /** The handler returned. A `not_found` is not ok here; the reader decides what counts as failure. */
  ok: boolean;
  /** The `AgoraError` code when not ok; `internal` for anything a source did not throw on purpose. */
  code: ErrorCode | null;
  durationMs: number;
  requestId: string;
}

/** Past this many characters of JSON, the arguments go on the line as a cut preview. */
const ARGS_MAX_CHARS = 2_048;

/**
 * Runs one tool the way every transport must: the credential check, the
 * per-tool TTL, the caller's abort signal, and one line either way. The MCP
 * server and the HTTP API both come through here, so a tool behaves the same
 * whichever address it was reached at.
 *
 * Input is the transport's business and arrives already validated against
 * `tool.inputSchema`. Failures are rethrown as they are: each transport
 * decides how a failure is serialised for its own caller. What is logged and
 * recorded here is the outcome, so that both transports report it alike.
 */
export async function callTool(
  source: Source,
  tool: AnySourceTool,
  input: Record<string, unknown>,
  deps: ToolDeps,
  signal: AbortSignal,
): Promise<unknown> {
  const key = sourceKey(source);
  const logger = deps.logger.child({ source: key, tool: tool.name });
  const args = deps.log.toolArgs ? describeArgs(input) : { argNames: Object.keys(input) };
  const cache = countingCache(deps.cache);
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(deps.deadlineMs);

  // Off by default. Its one job is to leave a trace of a call the host kills
  // before the outcome line below can be written.
  logger.debug("tool.start", args);

  const finish = (ok: boolean, code: ErrorCode | null): number => {
    const durationMs = Date.now() - startedAt;
    if (deps.record) {
      try {
        deps.record({
          calledAt: new Date(startedAt),
          source: key,
          tool: tool.name,
          transport: deps.transport,
          ok,
          code,
          durationMs,
          requestId: deps.requestId,
        });
      } catch (error) {
        logger.warn("record.failed", { error });
      }
    }
    return durationMs;
  };

  try {
    const missing = missingEnv(source.meta, deps.env);
    if (missing.length > 0) throw new MissingCredentialsError(missing);

    const data = await tool.handler(input, {
      cache,
      logger,
      ttl: ttlFor(source.meta, tool.name),
      // The caller leaving and the deadline passing both stop the handler's work.
      signal: AbortSignal.any([signal, deadline]),
      env: deps.env,
    });

    const durationMs = finish(true, null);
    const fields: LogFields = { ...args, durationMs, resultBytes: byteLength(data), cache: cache.counts() };
    if (durationMs >= deps.log.slowToolMs) logger.warn("tool.ok", { ...fields, slow: true });
    else logger.info("tool.ok", fields);
    return data;
  } catch (error) {
    // The caller left. Nothing about that says anything about the registry,
    // so it is noted and not counted.
    if (signal.aborted) {
      logger.info("tool.aborted", { ...args, durationMs: Date.now() - startedAt, cache: cache.counts() });
      throw error;
    }

    // Whatever the handler threw, it threw because the deadline cut it off:
    // the caller is owed a timeout, not the abort it came out as.
    if (deadline.aborted) {
      error = new UpstreamTimeoutError(
        `${source.meta.name} did not answer within ${deps.deadlineMs / 1000} s, so the call was stopped. Ask again: a slow registry is often quicker the second time, once part of the answer is cached.`,
        { cause: error },
      );
    }

    const code: ErrorCode = isAgoraError(error) ? error.code : "internal";
    const durationMs = finish(false, code);
    logger[levelFor(code)]("tool.failed", {
      ...args,
      durationMs,
      cache: cache.counts(),
      error: deps.log.toolArgs ? error : withoutArguments(error),
    });
    throw error;
  }
}

/**
 * How loudly a failure is logged. A registry that is down or a token that is
 * missing is ours to notice; a record that does not exist or an argument that
 * does not fit is the caller's, and still worth a line — a tool that keeps
 * being called wrongly is a description that needs rewriting. Anything a
 * source did not throw on purpose is a bug.
 */
function levelFor(code: ErrorCode): "info" | "warn" | "error" {
  switch (code) {
    case "not_found":
    case "invalid_input":
      return "info";
    case "internal":
      return "error";
    default:
      return "warn";
  }
}

/**
 * A failure as the line may carry it while argument values are kept off it.
 * An `AgoraError`'s message and details quote what it was asked — the ΑΔΑ
 * that was not found, the upstream URL with the VAT number in its path — so
 * only what kind of failure it was is kept. Anything else is a bug, where
 * the message and stack are the point, and is left whole.
 */
function withoutArguments(error: unknown): unknown {
  if (!isAgoraError(error)) return error;
  return { name: error.name, code: error.code, status: error.status, retryable: error.retryable };
}

/**
 * The arguments as one field, or as a cut preview when they would make the
 * line too long for a host to keep whole. Two names rather than one field of
 * two types, so a query on `args` never meets a string.
 */
function describeArgs(input: Record<string, unknown>): LogFields {
  const json = JSON.stringify(input);
  if (json.length <= ARGS_MAX_CHARS) return { args: input };
  return { argsPreview: `${json.slice(0, ARGS_MAX_CHARS)}…`, argsTruncated: true };
}

/**
 * The answer's size as compact JSON: a proxy for what goes on the wire — the
 * MCP mount pretty-prints, the API wraps — that costs one serialisation and
 * keeps this function handing back data rather than text.
 */
function byteLength(data: unknown): number | undefined {
  try {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    return text === undefined ? 0 : Buffer.byteLength(text);
  } catch {
    return undefined;
  }
}

interface CountingCache extends Cache {
  counts(): { gets: number; hits: number };
}

/**
 * The cache as the handler sees it, counting on the way through. Sources read
 * through `withCache`, so the counts say how much of an answer came from
 * memory without a source knowing it is being watched.
 */
function countingCache(cache: Cache): CountingCache {
  let gets = 0;
  let hits = 0;

  return {
    async get<T>(key: string): Promise<T | undefined> {
      gets += 1;
      const value = await cache.get<T>(key);
      if (value !== undefined) hits += 1;
      return value;
    },
    set: (key, value, ttlSeconds) => cache.set(key, value, ttlSeconds),
    delete: (key) => cache.delete(key),
    clear: () => cache.clear(),
    counts: () => ({ gets, hits }),
  };
}
