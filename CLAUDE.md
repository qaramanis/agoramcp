# agoramcp

pnpm workspace monorepo. MCP servers over open government data.

- `apps/server` — the deployable. Hono + `@modelcontextprotocol/sdk`, mounts every
  source at `/{country}/mcp/{source}` and each country's sources together at
  `/{country}/mcp`, where tool names are prefixed with the source that answers them.
- `apps/web` — Next.js landing page. Its own `AGENTS.md` applies there, not here.
- `packages/core` — `Source` interface, HTTP client, cache, errors, logger.
- `packages/sources/{country}/{id}` — one package per data source.

## Rules

- Adding a source must not require editing the server beyond one import in
  `apps/server/src/registry.ts`. If it does, the abstraction is wrong.
- Source packages never import the MCP SDK. Handlers return plain data and throw
  `AgoraError`s; `apps/server/src/mcp.ts` does the serialising.
- Every source declares its upstream licence and attribution in `meta.ts`.
  Attribution travels with the data — it is a licence condition, not decoration.
- Internal packages export TypeScript source (`"exports": "./src/index.ts"`) and
  run under `tsx`. There is no build step yet.
- Every tool is listed with a one-line description in
  `docs/{country}-documentation.md` and documented in full in its source's
  `DOCUMENTATION.md`. Adding or changing a tool updates both.
