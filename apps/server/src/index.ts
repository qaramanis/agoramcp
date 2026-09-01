import { StreamableHTTPTransport } from "@hono/mcp";
import { NotFoundError, createLogger, createMemoryCache } from "@agoramcp/core";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiError, describeCountryApi, describeSourceApi, findTool, handleToolCall } from "./api.ts";
import type { ToolDeps } from "./call.ts";
import { loadConfig } from "./config.ts";
import { createBundleServer, createSourceServer, SERVER_VERSION } from "./mcp.ts";
import { requestLogger } from "./middleware/logging.ts";
import { createRateLimiter } from "./middleware/rate-limit.ts";
import { apiPath, buildBundles, buildRegistry, describeBundles, describeRegistry } from "./registry.ts";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, base: { service: "agoramcp" } });
const cache = createMemoryCache({ maxEntries: config.cacheMaxEntries });
const registry = buildRegistry();
const bundles = buildBundles(registry);

const deps: ToolDeps = { cache, logger, env: process.env };

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

  return runServer(c, key, createSourceServer(source, deps));
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

  return runServer(c, country, createBundleServer(bundle, deps));
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
  const found = findTool(registry, c.req.param("country"), c.req.param("source"), c.req.param("tool"));

  if (found instanceof NotFoundError) return apiError(c, found);

  return handleToolCall(c, found.source, found.tool, deps);
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
 * One request, one server. The transport is stateless — no session to
 * resume — so the instance is torn down as soon as the reply is buffered.
 */
async function runServer(c: Context, mount: string, server: McpServer) {
  const transport = new StreamableHTTPTransport({
    // Stateless: no session to resume, so every request stands alone.
    sessionIdGenerator: undefined,
    // Buffers the reply into one JSON body, which is what makes it safe to
    // tear the server down as soon as handleRequest resolves.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return (await transport.handleRequest(c)) ?? c.body(null, 204);
  } finally {
    await server.close().catch((error: unknown) => {
      logger.warn("server.close failed", { mount, error });
    });
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

app.onError((error, c) => {
  logger.error("unhandled", { path: c.req.path, error });
  return c.json(
    { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null },
    500,
  );
});

/**
 * Default export so a host that owns the listener can mount the app as-is:
 * Vercel detects `src/index.ts` importing hono and runs it on Fluid compute
 * with zero configuration. `serve.ts` is the entry for hosts that don't —
 * it binds the port and runs the warm-up, which only pays off where the
 * process lives on between requests.
 */
export default app;
export { bundles, cache, config, logger, registry };
