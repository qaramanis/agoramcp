import {
  InvalidInputError,
  NotFoundError,
  RateLimitError,
  isAgoraError,
  toolErrorMessage,
  ttlFor,
  type AnySourceTool,
  type Source,
} from "@agoramcp/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { callTool, type ToolDeps } from "./call.ts";
import {
  apiPath,
  describeSourceMeta,
  describeTool,
  type Registry,
} from "./registry.ts";

/**
 * The HTTP API: the same tools the MCP server mounts, reachable with a plain
 * request. `/{country}/api/{source}/{tool}` takes its arguments as query
 * parameters on GET or as a JSON body on POST, runs the tool through the same
 * `callTool` the MCP server uses, and answers with the handler's data in an
 * envelope that carries the source's licence and attribution — an MCP session
 * is told those once when it connects; a stateless request has to be told
 * every time.
 *
 * Errors keep the `AgoraError` vocabulary: the HTTP status is the error's own
 * `status`, and the body names its `code`, so a script can branch on either.
 */

/** `GET /{country}/api` — every source the country mounts, and where each tool answers. */
export function describeCountryApi(country: string, registry: Registry) {
  const sources = [...registry.values()].filter((source) => source.country === country);
  if (sources.length === 0) return undefined;

  return {
    country,
    endpoint: apiPath(country),
    sources: sources.map((source) => ({
      ...describeSourceMeta(source),
      endpoint: apiPath(source.country, source.id),
      tools: source.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        endpoint: apiPath(source.country, source.id, tool.name),
      })),
    })),
  };
}

/** `GET /{country}/api/{source}` — one source, each tool with its schema and example. */
export function describeSourceApi(source: Source) {
  return {
    ...describeSourceMeta(source),
    endpoint: apiPath(source.country, source.id),
    tools: source.tools.map((tool) => ({
      ...describeTool(tool),
      endpoint: apiPath(source.country, source.id, tool.name),
    })),
  };
}

/**
 * Resolves the address to a source and tool, or to the `NotFoundError` the
 * caller should be sent. Kept apart from the route so the message names the
 * level that was missing — the country, the source or the tool.
 */
export function findTool(
  registry: Registry,
  country: string,
  sourceId: string,
  toolName: string,
): { source: Source; tool: AnySourceTool } | NotFoundError {
  const key = `${country}/${sourceId}`;
  const source = registry.get(key);
  if (!source) return new NotFoundError(`No source mounted at "${key}".`);

  const tool = source.tools.find((candidate) => candidate.name === toolName);
  if (!tool) return new NotFoundError(`${source.meta.name} has no tool called "${toolName}".`);

  return { source, tool };
}

/**
 * `GET|POST /{country}/api/{source}/{tool}`. Validation is strict where the
 * MCP server's is lenient: a query parameter the tool does not declare is a
 * 400 rather than silently dropped, because a typo that widens a search is
 * the kind of bug a script never notices.
 */
export async function handleToolCall(
  c: Context,
  source: Source,
  tool: AnySourceTool,
  deps: ToolDeps,
): Promise<Response> {
  const raw = c.req.method === "POST" ? await readJsonBody(c) : coerceQuery(tool, c.req.queries());
  if (raw instanceof InvalidInputError) return apiError(c, raw);

  const parsed = z.strictObject(tool.inputSchema).safeParse(raw);
  if (!parsed.success) {
    return apiError(
      c,
      new InvalidInputError(z.prettifyError(parsed.error), {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      }),
    );
  }

  try {
    const data = await callTool(source, tool, parsed.data, deps, c.req.raw.signal);

    // The handler already serves this answer from its own cache for `ttl`
    // seconds, so telling an intermediary the same thing costs nothing in
    // freshness. Bodies are never cached: a POST is a POST.
    if (c.req.method === "GET") {
      c.header("cache-control", `public, max-age=${ttlFor(source.meta, tool.name)}`);
    }

    return c.json({
      source: source.id,
      country: source.country,
      tool: tool.name,
      publisher: source.meta.publisher,
      license: source.meta.license,
      attribution: source.meta.attribution,
      upstreamUrl: source.meta.upstreamUrl,
      data,
    });
  } catch (error) {
    return apiError(c, error);
  }
}

/**
 * One shape for every failure. An `AgoraError` supplies its own status and
 * code; anything else is a 500 that still carries the message, because
 * sources throw plain `Error`s for things a caller can fix — the MCP server
 * shows the model the same text.
 */
export function apiError(c: Context, error: unknown): Response {
  if (isAgoraError(error)) {
    if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
      c.header("retry-after", String(error.retryAfterSeconds));
    }
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      error.status as ContentfulStatusCode,
    );
  }

  return c.json(
    { error: { code: "internal", message: toolErrorMessage(error), retryable: false } },
    500,
  );
}

/** A POST carries its arguments as one JSON object. An empty body is no arguments. */
async function readJsonBody(c: Context): Promise<Record<string, unknown> | InvalidInputError> {
  const text = await c.req.text();
  if (text.trim() === "") return {};

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new InvalidInputError("The request body was not JSON.");
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new InvalidInputError("The request body must be a JSON object of argument names to values.");
  }

  return body as Record<string, unknown>;
}

type Kind = "string" | "number" | "integer" | "boolean" | "other";

/**
 * A query string is all strings. This turns each value into what the tool's
 * schema asks for — a number, a boolean — so `?size=5` validates the way
 * `{"size": 5}` does. A value that will not convert is left as it came, so the
 * schema error names the real problem rather than a silent coercion. Kinds are
 * read once per tool from the same JSON Schema `GET /` publishes.
 */
function coerceQuery(
  tool: AnySourceTool,
  queries: Record<string, string[]>,
): Record<string, unknown> | InvalidInputError {
  const kinds = kindsFor(tool);
  const out: Record<string, unknown> = {};

  for (const [name, values] of Object.entries(queries)) {
    if (values.length > 1) {
      return new InvalidInputError(`"${name}" was given more than once; every argument takes one value.`);
    }
    // Unknown names pass through as strings: the strict parse reports them by name.
    out[name] = coerce(values[0] ?? "", kinds.get(name) ?? "other");
  }

  return out;
}

function coerce(raw: string, kind: Kind): unknown {
  switch (kind) {
    case "number":
    case "integer": {
      const trimmed = raw.trim();
      const parsed = Number(trimmed);
      return trimmed !== "" && Number.isFinite(parsed) ? parsed : raw;
    }
    case "boolean":
      // A bare `?flag` is the HTTP idiom for true; anything unrecognised is
      // left for the schema to refuse by name.
      if (raw === "" || raw === "true" || raw === "1") return true;
      if (raw === "false" || raw === "0") return false;
      return raw;
    default:
      return raw;
  }
}

const KINDS = new WeakMap<AnySourceTool, Map<string, Kind>>();

function kindsFor(tool: AnySourceTool): Map<string, Kind> {
  let kinds = KINDS.get(tool);
  if (kinds) return kinds;

  kinds = new Map();
  const schema = z.toJSONSchema(z.object(tool.inputSchema)) as {
    properties?: Record<string, JsonSchemaNode>;
  };
  for (const [name, node] of Object.entries(schema.properties ?? {})) {
    kinds.set(name, kindOf(node));
  }

  KINDS.set(tool, kinds);
  return kinds;
}

type JsonSchemaNode = {
  type?: string | string[];
  anyOf?: JsonSchemaNode[];
};

/** The one non-null primitive a node accepts, or `other` when it is not that simple. */
function kindOf(node: JsonSchemaNode): Kind {
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  const primitive = types.find((type) => type !== "null");
  if (primitive) return asKind(primitive);

  for (const member of node.anyOf ?? []) {
    const kind = kindOf(member);
    if (kind !== "other") return kind;
  }
  return "other";
}

function asKind(type: string): Kind {
  return type === "string" || type === "number" || type === "integer" || type === "boolean"
    ? type
    : "other";
}
