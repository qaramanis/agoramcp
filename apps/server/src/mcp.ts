import {
  MissingCredentialsError,
  missingEnv,
  qualifiedToolName,
  sourceKey,
  toolErrorMessage,
  toolPrefix,
  ttlFor,
  type AnySourceTool,
  type Bundle,
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
export function createSourceServer(source: Source, deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: `agoramcp-${source.country}-${source.id}`, title: source.meta.name, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: sourceInstructions(source) },
  );

  for (const tool of source.tools) {
    register(server, source, tool, tool.name, deps);
  }

  return server;
}

/**
 * Every source a country publishes behind one server. The tools are the same
 * objects `createSourceServer` registers — nothing is reimplemented — but they
 * are registered under `{source}_{tool}`, because tool names are unique only
 * within a source and a bundle puts several side by side.
 */
export function createBundleServer(bundle: Bundle, deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: `agoramcp-${bundle.country}`, title: bundle.meta.name, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: bundleInstructions(bundle) },
  );

  for (const source of bundle.sources) {
    for (const tool of source.tools) {
      register(server, source, tool, qualifiedToolName(source, tool), deps);
    }
  }

  return server;
}

/**
 * Registers one tool under the name this server calls it by. The handler is
 * the source's own, so a bundled tool and a per-source tool run identical code
 * and resolve their TTL and credentials from the same `meta`.
 */
function register(
  server: McpServer,
  source: Source,
  tool: AnySourceTool,
  name: string,
  deps: McpServerDeps,
): void {
  const key = sourceKey(source);

  server.registerTool(
    name,
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

/**
 * Shown to the model once per session. Carrying the licence here rather than on
 * every tool result keeps the attribution requirement met without bloating
 * each response.
 */
function sourceInstructions(source: Source): string {
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

/**
 * The bundle's session instructions do two jobs a per-source server never has
 * to: they map each prefix to the registry behind it, so the model can route a
 * question without calling tools to find out, and they carry every member's
 * licence, since attribution is owed per registry rather than per server.
 */
function bundleInstructions(bundle: Bundle): string {
  const lines = [
    `${bundle.meta.name} — ${bundle.meta.description}`,
    ``,
    `Each registry answers under its own tool prefix. Choose the prefix that`,
    `matches the question, then the tool within it:`,
    ``,
  ];

  for (const source of bundle.sources) {
    lines.push(
      `${toolPrefix(source)}_* — ${source.meta.name}: ${source.meta.description}`,
      `  Published by ${source.meta.publisher} (${source.meta.upstreamUrl}).`,
      `  Licence: ${source.meta.license}. Attribute this data to: ${source.meta.attribution}.`,
      ``,
    );
  }

  lines.push(
    `Attribution is owed to the registry whose tool produced the answer, not to`,
    `the whole list above.`,
    ``,
    `This server is a read-only proxy. It cannot write to any upstream registry,`,
    `and it returns only what those registries publish — say so rather than`,
    `guessing when a question falls outside these tools.`,
  );

  return lines.join("\n");
}

function render(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}
