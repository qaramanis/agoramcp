import { serve } from "@hono/node-server";
import app, { bundles, cache, config, logger, registry } from "./index.ts";

/**
 * The long-running entry: binds the port, then runs the boot-time warm-up.
 * Hosts that own the listener — Vercel's Hono runtime among them — import
 * `index.ts` directly and never load this file, so nothing here may be
 * needed for a request to be answered.
 */
serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  logger.info("listening", {
    address: `http://${config.host}:${info.port}`,
    sources: [...registry.keys()],
    countries: [...bundles.keys()],
  });
});

/** Generous: a warm-up exists precisely because the thing it fetches is slow. */
const WARM_TIMEOUT_MS = 180_000;

// Off the request path and after the port is open, so a slow prefetch never
// delays the first answer — it only makes it faster when it lands first.
for (const [key, source] of registry) {
  if (!source.warm) continue;
  const warmLogger = logger.child({ source: key });
  const startedAt = Date.now();
  source
    .warm({ cache, logger: warmLogger, signal: AbortSignal.timeout(WARM_TIMEOUT_MS), env: process.env })
    .then(
      () => warmLogger.info("warm.ok", { durationMs: Date.now() - startedAt }),
      (error: unknown) => warmLogger.warn("warm.failed", { durationMs: Date.now() - startedAt, error }),
    );
}
