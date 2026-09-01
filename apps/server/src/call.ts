import {
  MissingCredentialsError,
  missingEnv,
  sourceKey,
  ttlFor,
  type AnySourceTool,
  type Cache,
  type Logger,
  type Source,
} from "@agoramcp/core";

/** What every transport hands a tool, beyond the request itself. */
export interface ToolDeps {
  cache: Cache;
  logger: Logger;
  env: Readonly<Partial<Record<string, string>>>;
}

/**
 * Runs one tool the way every transport must: the credential check, the
 * per-tool TTL, the caller's abort signal, and one log line either way. The
 * MCP server and the HTTP API both come through here, so a tool behaves the
 * same whichever address it was reached at.
 *
 * Input is the transport's business and arrives already validated against
 * `tool.inputSchema`. Failures are rethrown as they are: each transport
 * decides how a failure is serialised for its own caller.
 */
export async function callTool(
  source: Source,
  tool: AnySourceTool,
  input: Record<string, unknown>,
  deps: ToolDeps,
  signal: AbortSignal,
): Promise<unknown> {
  const logger = deps.logger.child({ source: sourceKey(source), tool: tool.name });
  const startedAt = Date.now();

  try {
    const missing = missingEnv(source.meta, deps.env);
    if (missing.length > 0) throw new MissingCredentialsError(missing);

    const data = await tool.handler(input, {
      cache: deps.cache,
      logger,
      ttl: ttlFor(source.meta, tool.name),
      signal,
      env: deps.env,
    });

    logger.info("tool.ok", { durationMs: Date.now() - startedAt });
    return data;
  } catch (error) {
    logger.warn("tool.failed", { durationMs: Date.now() - startedAt, error });
    throw error;
  }
}
