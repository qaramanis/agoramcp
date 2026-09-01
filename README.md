# agoramcp

MCP servers over open government data, starting with Greece.

Each data source is mounted as its own MCP server at `/{country}/mcp/{source}`,
and every source a country publishes is mounted together at `/{country}/mcp`.
Both speak Streamable HTTP. Point Claude, Cursor or any MCP client at one of
those URLs and it can query the upstream registries in natural language.

On a country server the tools are the sources' own, registered under a prefix
naming the source that answers them — `diavgeia_get_decision` — because a tool
name is unique only within its source.

## Layout

```
apps/
  server/            the deployable — Hono + @modelcontextprotocol/sdk
  web/               landing page (Next.js)
packages/
  core/              Source interface, HTTP client, cache, errors, logger
  sources/{cc}/{id}/ one package per data source
```

## Running

```bash
pnpm install
pnpm dev            # MCP server on :3000
pnpm dev:web        # landing page on :3001
pnpm typecheck
```

Verify a source with the official inspector:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3000/gr/mcp/test \
  --transport http --method tools/list
```

`GET /` lists every mounted source and country server with its tools, licence
and attribution.
`GET /health` is the liveness probe.

Every tool a country exposes is listed, one line each, in
`docs/{country}-documentation.md` — [`docs/gr-documentation.md`](docs/gr-documentation.md)
for Greece. Each source's own `DOCUMENTATION.md` is the full reference.

## Adding a source

Adding a country or a source is a new folder plus one import — the server has no
per-source code.

1. `packages/sources/{country}/{id}/` with `src/{index,tools,client,meta}.ts`.
2. `meta.ts` — publisher, upstream URL, licence, attribution, cache TTLs.
3. `tools.ts` — `defineTool({ name, title, description, inputSchema, example, handler })`.
   Handlers return plain data; the server serialises it into MCP content and
   turns thrown `AgoraError`s into tool errors the model can read. `example`
   is one runnable call, checked against the schema at boot: the landing
   page's live console builds its form from the schema and prefills it from
   the example, so a tool is described once and appears there by itself.
4. `index.ts` — `defineSource({ id, country, meta, tools })`. Add a `warm`
   hook if the source's first call would otherwise pay for something slow, such
   as a whole register: the server runs it once at boot, in the background.
5. Add the package to `apps/server/package.json` and import it in
   `apps/server/src/registry.ts`. It joins its country's server automatically;
   `UNBUNDLED` in that file is the opt-out.
6. List its tools, one line each, in `docs/{country}-documentation.md`, and
   write the full reference in the package's `DOCUMENTATION.md`.

`packages/sources/gr/test` is the reference shape. It has no upstream and exists
only to prove the transport; delete it once real sources are mounted.

## Configuration

Copy `.env.example` to `.env`. Everything has a working default except the
per-source API tokens, and a source with missing credentials fails with a clear
message rather than breaking the server.

## Licensing

The code is one thing, the data is another. Every source carries its upstream
licence and attribution in `meta.ts`; those strings are surfaced in the server's
MCP instructions and on `GET /`, so attribution travels with the data.
