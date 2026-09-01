import { loadCatalogue } from "@/data/catalogue";
import { MCP_SERVER_URL } from "@/data/registry";
import { buildArguments, providerByEndpoint } from "@/data/playground";

/**
 * Server-side proxy for the live playground.
 *
 * The browser never talks to the MCP server directly: that would need CORS on
 * a server whose address is not meant to be public, and it would let the page
 * name any endpoint it liked. Here the endpoint and the tool have to match the
 * server's own registry — the same catalogue the page was rendered from —
 * before anything is forwarded.
 */

const TIMEOUT_MS = 30_000;

/** A playground call is a handful of short filters — nothing near this. */
const MAX_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("The request body was not JSON.", 400);
  }

  if (payload === null || typeof payload !== "object") {
    return fail("Expected an object with `endpoint`, `tool` and `values`.", 400);
  }

  const { endpoint, tool, values } = payload as {
    endpoint?: unknown;
    tool?: unknown;
    values?: unknown;
  };

  // Cached for a minute alongside the page's own read, so this is not a round
  // trip to the MCP server per call.
  const catalogue = await loadCatalogue();
  if (catalogue.unavailable) return fail(catalogue.unavailable, 502);

  const provider = providerByEndpoint(catalogue.countries, endpoint);
  if (!provider) {
    return fail(`No provider is mounted at ${JSON.stringify(endpoint)}.`, 400);
  }

  const definition = provider.tools.find((candidate) => candidate.name === tool);
  if (!definition) {
    return fail(`${provider.name} has no tool called ${JSON.stringify(tool)}.`, 400);
  }

  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return fail("`values` must be an object of field names to strings.", 400);
  }

  // Rebuilt from the tool's schema rather than trusted: only fields the tool
  // declares survive, and each one is coerced to the type it declared.
  const stringValues: Record<string, string> = {};
  for (const field of definition.fields) {
    const value = (values as Record<string, unknown>)[field.name];
    stringValues[field.name] = typeof value === "string" ? value : "";
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: definition.name, arguments: buildArguments(definition, stringValues) },
  });

  if (body.length > MAX_BODY_BYTES) {
    return fail("Those arguments are too long to send.", 413);
  }

  const startedAt = Date.now();
  let upstream: Response;

  try {
    upstream = await fetch(`${MCP_SERVER_URL}${provider.endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The transport rejects a POST that will not accept both.
        accept: "application/json, text/event-stream",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return fail(unreachable(error), 502);
  }

  const text = await upstream.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON — an error page from something in front of the server, most
    // likely. Hand it back verbatim rather than pretending it parsed.
    parsed = { raw: text };
  }

  return Response.json({
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    bytes: new TextEncoder().encode(text).length,
    body: parsed,
  });
}

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function unreachable(error: unknown): string {
  const where =
    process.env.NODE_ENV === "production" ? "" : ` at ${MCP_SERVER_URL}`;

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return `The MCP server${where} did not answer within ${TIMEOUT_MS / 1000}s.`;
  }
  return `Could not reach the MCP server${where}. Is it running?`;
}
