import { serve } from "@hono/node-server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { createLogger, createMemoryCache } from "@agoramcp/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig } from "./config.ts";
import { createMcpServer, SERVER_VERSION } from "./mcp.ts";
import { requestLogger } from "./middleware/logging.ts";
import { createRateLimiter } from "./middleware/rate-limit.ts";
import { buildRegistry, describeRegistry } from "./registry.ts";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, base: { service: "agoramcp" } });
const cache = createMemoryCache({ maxEntries: config.cacheMaxEntries });
const registry = buildRegistry();

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

app.get("/health", (c) => c.json({ status: "ok", version: SERVER_VERSION, sources: registry.size }));

app.get("/", (c) =>
  c.json({
    name: "agoramcp",
    version: SERVER_VERSION,
    description: "MCP servers over Greek open government data.",
    sources: describeRegistry(registry),
  }),
);

const limiter = createRateLimiter(config.rateLimitPerMinute);
if (limiter) app.use("/:country/mcp/:source", limiter);

app.all("/:country/mcp/:source", async (c) => {
  const key = `${c.req.param("country")}/${c.req.param("source")}`;
  const source = registry.get(key);

  if (!source) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32601, message: `No source mounted at "${key}".` },
        id: null,
      },
      404,
    );
  }

  const server = createMcpServer(source, { cache, logger, env: process.env });
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
      logger.warn("server.close failed", { source: key, error });
    });
  }
});

app.onError((error, c) => {
  logger.error("unhandled", { path: c.req.path, error });
  return c.json(
    { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null },
    500,
  );
});

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  logger.info("listening", {
    address: `http://${config.host}:${info.port}`,
    sources: [...registry.keys()],
  });
});
