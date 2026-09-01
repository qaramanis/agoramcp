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

## Deploying

Two Vercel projects, one repository. Each project points at its own app through
Root Directory; Vercel finds `pnpm-lock.yaml` at the workspace root, installs
the workspace, and rebuilds a project only when its own files or its workspace
dependencies change — so `packages/**` redeploys `apps/server`, whose
`package.json` names those packages, and a web-only commit leaves it alone.

1. **Add New → Project → import this repo.** Root Directory `apps/web`.
   Next.js is detected. Add the variables below, deploy.
2. **Again for the server.** Root Directory `apps/server`. Hono is detected
   from `src/index.ts`, which imports `hono` and default-exports the app, and
   runs on Fluid compute. There is no build command; Vercel compiles and
   bundles the TypeScript entry itself.
3. **Variables.**
   - `server`: `CORS_ORIGINS` and any source tokens from `.env.example`.
     `PORT` and `HOST` do not apply; Vercel owns the listener.
   - `web`: `NEXT_PUBLIC_MCP_BASE_URL` and `MCP_SERVER_URL`, both the server
     project's production URL. The first is inlined at build time, so redeploy
     `web` if that URL ever changes.

One dev dependency exists for Vercel's sake: `apps/server` lists `undici-types`
because Vercel type-checks the entry with a resolver that does not follow
pnpm's symlinks, so without it `@types/node` cannot reach the package that
gives `Response` its members and the build fails on `c.res.status`. The pnpm
version needs nothing extra — Vercel reads the root `packageManager` pin.

What is different on Vercel: there is no boot, so `warm` never runs. A fresh
instance fills the Diavgeia register on the first call that needs it and holds
it for as long as the instance lives, which a lightly used server will feel on
the first organisation search after a quiet spell. The in-memory rate limiter
counts per instance — keep it as a soft cap, or set `RATE_LIMIT_PER_MINUTE=0`
and add a Firewall rate-limit rule.

Any host that runs a persistent Node process works as well: `pnpm start` runs
`apps/server/src/serve.ts`, which binds the port and then runs the warm-up.
`apps/server/railway.json` is a ready-made config for Railway.

## Database

`apps/web` keeps the country requests in Postgres (Neon in production). The
schema is a queue of migrations, run the way Laravel runs them: files under
`apps/web/db/migrations/` named `YYYY_MM_DD_HHMMSS_<name>.ts`, each exporting
`up` and `down`, and a `migrations` table that records every one that has run
with the batch it ran in. There is no schema file to keep in step — the
migrations are the schema.

```bash
pnpm --filter @agoramcp/web db:migrate              # run what is pending, as one batch
pnpm --filter @agoramcp/web db:rollback             # reverse the last batch
pnpm --filter @agoramcp/web db:rollback --step=1    # or the last N migrations
pnpm --filter @agoramcp/web db:reset                # reverse everything
pnpm --filter @agoramcp/web db:status               # what has run, what has not
pnpm --filter @agoramcp/web db:make add_x_to_y      # scaffold a new migration
pnpm --filter @agoramcp/web db:seed                 # every seeder; `db:seed countries` for one
```

Each migration runs in a transaction with its own bookkeeping row, so one that
fails leaves nothing behind. The scripts read `apps/web/.env.local` and use
`DATABASE_URL_UNPOOLED` where it is set — a DDL transaction has to stay on one
server session, which Neon's pooler does not promise.

`db:seed countries` loads the full ISO 3166-1 list from `apps/web/data/countries.ts`
and marks the countries with a source mounted as supported. It is safe to run
again: it upserts, and it never unmarks a country.

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
