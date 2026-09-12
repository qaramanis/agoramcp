import { StreamableHTTPTransport } from "@hono/mcp";
import { NotFoundError, createLogger, createMemoryCache } from "@agoramcp/core";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiError, describeCountryApi, describeSourceApi, findTool, handleToolCall } from "./api.ts";
import type { ToolDeps, Transport } from "./call.ts";
import { loadConfig } from "./config.ts";
import { createBundleServer, createSourceServer, SERVER_VERSION, type CallTrace } from "./mcp.ts";
import { PROBE_HEADER, requestLogger, type CallSummary } from "./middleware/logging.ts";
import { createRateLimiter } from "./middleware/rate-limit.ts";
import { createCallRecorder } from "./record.ts";
import {
  apiPath,
  buildBundles,
  buildRegistry,
  describeBundles,
  describeRegistry,
  resolveBundleTool,
} from "./registry.ts";
import { calledToolName, summariseRpc } from "./rpc.ts";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, base: { service: "agoramcp" } });
const cache = createMemoryCache({ maxEntries: config.cacheMaxEntries });
const registry = buildRegistry();
const bundles = buildBundles(registry);

/** Where each call's outcome is kept for the status history — nowhere, without a database. */
const record = config.databaseUrl ? createCallRecorder(config.databaseUrl, logger) : undefined;

/** What every call shares. `requestDeps` adds what one request is. */
const shared = {
  cache,
  env: process.env,
  log: { slowToolMs: config.slowToolMs, toolArgs: config.logToolArgs },
};

const app = new Hono();

app.use("*", requestLogger(logger));
app.use(
  "*",
  cors({
    origin: config.corsOrigins === "*" ? "*" : config.corsOrigins,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "authorization"],
    // Browser-based MCP clients read the negotiated session and version back.
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version", "x-request-id"],
  }),
);

app.get("/health", (c) =>
  c.json({ status: "ok", version: SERVER_VERSION, sources: registry.size, countries: bundles.size }),
);

app.get("/", (c) =>
  c.json({
    name: "agoramcp",
    version: SERVER_VERSION,
    description: "MCP servers over Greek open government data.",
    countries: describeBundles(bundles),
    sources: describeRegistry(registry),
  }),
);

const limiter = createRateLimiter(config.rateLimitPerMinute);
if (limiter) {
  // Both mounts, or the country server would ship without a limit.
  app.use("/:country/mcp", limiter);
  app.use("/:country/mcp/:source", limiter);
}

// The API's budget stops at the source, like the MCP mounts', so a script
// gets one allowance per registry rather than one per tool it happens to use.
const apiLimiter = createRateLimiter(config.rateLimitPerMinute, {
  scope: (c) => apiPath(c.req.param("country") ?? "", c.req.param("source") ?? ""),
  message: {
    error: {
      code: "rate_limited",
      message: "Rate limit exceeded for this source. Try again in a minute.",
      retryable: true,
    },
  },
});
if (apiLimiter) {
  app.use("/:country/api/:source/:tool", apiLimiter);
}

app.all("/:country/mcp/:source", async (c) => {
  const key = `${c.req.param("country")}/${c.req.param("source")}`;
  const source = registry.get(key);

  if (!source) return notMounted(c, "source", key);

  return runServer(
    c,
    key,
    (name) => (source.tools.some((tool) => tool.name === name) ? { source: key, tool: name } : undefined),
    (deps, trace) => createSourceServer(source, deps, trace),
  );
});

/**
 * The country server: every source that country publishes, tools prefixed by
 * the source that answers them. A distinct path segment count from the mount
 * above, so the two routes cannot shadow each other.
 */
app.all("/:country/mcp", async (c) => {
  const country = c.req.param("country");
  const bundle = bundles.get(country);

  if (!bundle) return notMounted(c, "country", country);

  return runServer(
    c,
    country,
    (name) => resolveBundleTool(bundle, name),
    (deps, trace) => createBundleServer(bundle, deps, trace),
  );
});

/**
 * The HTTP API, beside the MCP mounts and over the same tools. Two index
 * levels so the address describes itself, then the call. `api.ts` owns the
 * shapes; these routes only resolve the address.
 */
app.get("/:country/api", (c) => {
  const country = c.req.param("country");
  const body = describeCountryApi(country, registry);

  if (!body) return apiError(c, new NotFoundError(`No country mounted at "${country}".`));

  return c.json(body);
});

app.get("/:country/api/:source", (c) => {
  const key = `${c.req.param("country")}/${c.req.param("source")}`;
  const source = registry.get(key);

  if (!source) return apiError(c, new NotFoundError(`No source mounted at "${key}".`));

  return c.json(describeSourceApi(source));
});

app.on(["GET", "POST"], "/:country/api/:source/:tool", async (c) => {
  const key = `${c.req.param("country")}/${c.req.param("source")}`;
  const found = findTool(registry, c.req.param("country"), c.req.param("source"), c.req.param("tool"));

  if (found instanceof NotFoundError) return apiError(c, found);

  return handleToolCall(c, found.source, found.tool, requestDeps(c, "api", key));
});

// Anything but the two verbs above: say which verbs there are, as JSON like
// every other answer on this path, rather than the framework's bare 404.
app.all("/:country/api/:source/:tool", (c) => {
  c.header("allow", "GET, POST");
  return c.json(
    {
      error: {
        code: "method_not_allowed",
        message: "Use GET with query parameters, or POST with a JSON body.",
        retryable: false,
      },
    },
    405,
  );
});

/**
 * The deps for one request: what every call shares, plus the request's own
 * logger — already carrying its id — stamped with how and where the call
 * arrived. The status probe is logged like any call and marked as one, but
 * not recorded: the probe writes its own row, and would otherwise count
 * twice.
 */
function requestDeps(c: Context, transport: Transport, mount: string): ToolDeps {
  const probe = c.req.header(PROBE_HEADER) !== undefined;

  return {
    ...shared,
    logger: c.get("logger").child({ transport, mount, ...(probe ? { probe: true } : {}) }),
    transport,
    mount,
    requestId: c.get("requestId"),
    ...(record && !probe ? { record } : {}),
  };
}

/**
 * One request, one server. The transport is stateless — no session to
 * resume — so the instance is torn down as soon as the reply is buffered.
 *
 * The body is read here first and handed to the transport parsed, so the
 * request line can say which JSON-RPC method this POST was and, for a
 * `tools/call`, which source and tool it named. `resolve` is the mount's own
 * reading of a tool name — qualified on a country server, bare on a source's.
 */
async function runServer(
  c: Context,
  mount: string,
  resolve: (name: string) => CallSummary | undefined,
  build: (deps: ToolDeps, trace: CallTrace) => McpServer,
) {
  const log = c.get("logger");

  // A body that is not JSON is left for the transport to refuse in its own words.
  const body: unknown = await c.req.json().catch(() => undefined);
  const rpc = summariseRpc(body);
  if (rpc) c.set("rpc", rpc);

  const calledName = calledToolName(body);
  const call = calledName === undefined ? undefined : resolve(calledName);
  if (call) c.set("call", call);

  const trace: CallTrace = { toolCalls: 0 };
  const server = build(requestDeps(c, "mcp", mount), trace);
  // Otherwise a failure to send a reply, or a message the SDK cannot place, is dropped silently.
  server.server.onerror = (error) => log.warn("mcp.protocol_error", { mount, error });

  const transport = new StreamableHTTPTransport({
    // Stateless: no session to resume, so every request stands alone.
    sessionIdGenerator: undefined,
    // Buffers the reply into one JSON body, which is what makes it safe to
    // tear the server down as soon as handleRequest resolves.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    const response = (await transport.handleRequest(c, body)) ?? c.body(null, 204);

    // A `tools/call` that never reached a handler was refused by the SDK —
    // a name it does not know, or arguments its schema would not take — and
    // answered as an ordinary result, so nothing else would have said so.
    if (calledName !== undefined && trace.toolCalls === 0) {
      log.info("tool.rejected", {
        transport: "mcp",
        mount,
        ...call,
        tool: call?.tool ?? calledName,
        reason: await rejection(response),
      });
    }

    return response;
  } finally {
    await server.close().catch((error: unknown) => {
      log.warn("server.close failed", { mount, error });
    });
  }
}

/** The SDK's own explanation, from the buffered reply. */
async function rejection(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.clone().json()) as {
      result?: { content?: { text?: string }[] };
      error?: { message?: string };
    };
    return payload.result?.content?.[0]?.text ?? payload.error?.message;
  } catch {
    return undefined;
  }
}

function notMounted(c: Context, what: string, key: string) {
  return c.json(
    {
      jsonrpc: "2.0",
      error: { code: -32601, message: `No ${what} mounted at "${key}".` },
      id: null,
    },
    404,
  );
}

app.onError(async (error, c) => {
  const log = c.get("logger") ?? logger;

  // The transport's own refusals — the wrong Accept, the wrong Content-Type,
  // a body that is not JSON — arrive as exceptions carrying the reply they
  // want sent. Send it, and say so: a 4xx of theirs is not a 500 of ours.
  if (error instanceof HTTPException) {
    const response = error.getResponse();
    log.warn("request.rejected", {
      path: c.req.path,
      status: response.status,
      reason: error.message || (await messageOf(response)),
    });
    return response;
  }

  log.error("unhandled", { path: c.req.path, error });
  return c.json(
    { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null },
    500,
  );
});

/** The reason in a JSON-RPC error reply, when the exception carries one instead of a message. */
async function messageOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { error?: { message?: string } };
    return body.error?.message;
  } catch {
    return undefined;
  }
}

/**
 * Default export so a host that owns the listener can mount the app as-is:
 * Vercel detects `src/index.ts` importing hono and runs it on Fluid compute
 * with zero configuration. `serve.ts` is the entry for hosts that don't —
 * it binds the port and runs the warm-up, which only pays off where the
 * process lives on between requests.
 */
export default app;
export { bundles, cache, config, logger, registry };
