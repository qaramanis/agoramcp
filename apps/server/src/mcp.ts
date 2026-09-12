import {
  qualifiedToolName,
  toolErrorMessage,
  toolPrefix,
  type AnySourceTool,
  type Bundle,
  type Source,
} from "@agoramcp/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callTool, type ToolDeps } from "./call.ts";

export const SERVER_VERSION = "0.1.0";

/**
 * How many times one request reached a handler. The SDK validates a
 * `tools/call` before calling us and answers a bad one itself — an unknown
 * name, arguments that do not fit the schema — as an ordinary result, so the
 * only way to know it did is that the count stayed at zero.
 */
export interface CallTrace {
  toolCalls: number;
}

/**
 * Wraps one `Source` in an MCP server. Called per request: the transport is
 * stateless, so a fresh instance keeps concurrent callers isolated.
 */
export function createSourceServer(source: Source, deps: ToolDeps, trace: CallTrace): McpServer {
  const server = new McpServer(
    { name: `agoramcp-${source.country}-${source.id}`, title: source.meta.name, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: sourceInstructions(source) },
  );

  for (const tool of source.tools) {
    register(server, source, tool, tool.name, deps, trace);
  }

  return server;
}

/**
 * Every source a country publishes behind one server. The tools are the same
 * objects `createSourceServer` registers — nothing is reimplemented — but they
 * are registered under `{source}_{tool}`, because tool names are unique only
 * within a source and a bundle puts several side by side.
 */
export function createBundleServer(bundle: Bundle, deps: ToolDeps, trace: CallTrace): McpServer {
  const server = new McpServer(
    { name: `agoramcp-${bundle.country}`, title: bundle.meta.name, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: bundleInstructions(bundle) },
  );

  for (const source of bundle.sources) {
    for (const tool of source.tools) {
      register(server, source, tool, qualifiedToolName(source, tool), deps, trace);
    }
  }

  return server;
}

/**
 * Registers one tool under the name this server calls it by. The SDK has
 * validated the input against `inputSchema` by the time the handler runs, and
 * `callTool` is the same path the HTTP API takes, so a bundled tool, a
 * per-source tool and an API call all run identical code.
 */
function register(
  server: McpServer,
  source: Source,
  tool: AnySourceTool,
  name: string,
  deps: ToolDeps,
  trace: CallTrace,
): void {
  server.registerTool(
    name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: { title: tool.title, ...tool.annotations } } : {}),
    },
    async (input: Record<string, unknown>, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
      trace.toolCalls += 1;
      try {
        const data = await callTool(source, tool, input, deps, extra.signal);
        return { content: [{ type: "text", text: render(data) }] };
      } catch (error) {
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
