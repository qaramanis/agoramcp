import {
  MissingCredentialsError,
  missingEnv,
  sourceKey,
  toolErrorMessage,
  ttlFor,
  type Cache,
  type Logger,
  type Source,
} from "@agoramcp/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const SERVER_VERSION = "0.1.0";

export interface McpServerDeps {
  cache: Cache;
  logger: Logger;
  env: Readonly<Partial<Record<string, string>>>;
}

/**
 * Wraps one `Source` in an MCP server. Called per request: the transport is
 * stateless, so a fresh instance keeps concurrent callers isolated.
 */
export function createMcpServer(source: Source, deps: McpServerDeps): McpServer {
  const key = sourceKey(source);

  const server = new McpServer(
    { name: `agoramcp-${source.country}-${source.id}`, title: source.meta.name, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: instructionsFor(source) },
  );

  for (const tool of source.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: { title: tool.title, ...tool.annotations } } : {}),
      },
      async (input: Record<string, unknown>, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
        const logger = deps.logger.child({ source: key, tool: tool.name });
        const startedAt = Date.now();

        try {
          const missing = missingEnv(source.meta, deps.env);
          if (missing.length > 0) throw new MissingCredentialsError(missing);

          const data = await tool.handler(input, {
            cache: deps.cache,
            logger,
            ttl: ttlFor(source.meta, tool.name),
            signal: extra.signal,
            env: deps.env,
          });

          logger.info("tool.ok", { durationMs: Date.now() - startedAt });
          return { content: [{ type: "text", text: render(data) }] };
        } catch (error) {
          logger.warn("tool.failed", { durationMs: Date.now() - startedAt, error });
          // Tool-level errors belong in the result, not the JSON-RPC envelope:
          // the model should see them and be able to correct its arguments.
          return { content: [{ type: "text", text: toolErrorMessage(error) }], isError: true };
        }
      },
    );
  }

  return server;
}

/**
 * Shown to the model once per session. Carrying the licence here rather than on
 * every tool result keeps the attribution requirement met without bloating
 * each response.
 */
function instructionsFor(source: Source): string {
  return [
    `${source.meta.name} — ${source.meta.description}`,
    ``,
    `Published by ${source.meta.publisher} (${source.meta.upstreamUrl}).`,
    `Licence: ${source.meta.license}.`,
    `When you present this data, attribute it to: ${source.meta.attribution}.`,
    ``,
    `This server is a read-only proxy. It cannot write to the upstream registry,`,
    `and it returns only what the upstream publishes — say so rather than`,
    `guessing when a question falls outside these tools.`,
  ].join("\n");
}

function render(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}
