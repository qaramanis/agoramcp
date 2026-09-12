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
  ckan/              the CKAN adapter — tools for any CKAN portal, pointed at one by a source
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

### HTTP API

The same tools, without an MCP client. Every source the server mounts also
answers at `/{country}/api/{source}/{tool}`, running the identical handler the
MCP mount runs:

```bash
curl -G --data-urlencode 'ada=9ΓΓ346ΝΨ2Ν-Β5Τ' \
  http://localhost:3000/gr/api/diavgeia/get_decision
```

- `GET` takes the tool's arguments as query parameters. Values are coerced to
  what the schema declares — `size=5` becomes a number, `includeInactive` on
  its own means `true`. `POST` takes them as one JSON object instead. Query
  values must be URL-encoded, as every HTTP library does for you; Node rejects
  a raw non-ASCII request line before the server sees it, hence curl's
  `-G --data-urlencode` above.
- Validation is strict: a parameter the tool does not declare is a `400`, so a
  typo cannot silently widen a search.
- The response is an envelope — `source`, `tool`, `publisher`, `license`,
  `attribution`, `upstreamUrl` — around `data`, the handler's own result. A
  stateless request has to carry the attribution every time; an MCP session is
  told once.
- Errors are `{ "error": { "code", "message", "retryable", "details"? } }` with
  the `AgoraError`'s own HTTP status: `invalid_input` 400, `not_found` 404,
  `rate_limited` 429, `upstream_error` 502, `upstream_unavailable` and
  `missing_credentials` 503, `upstream_timeout` 504. Verbs other than GET and
  POST get a 405.
- `GET /{country}/api` lists the country's sources and where each tool answers;
  `GET /{country}/api/{source}` adds every tool's input schema and example.
- Successful GETs carry `Cache-Control: max-age` equal to the tool's cache TTL.
  The rate limit is the same as the MCP mounts' — per client, per source — and
  is reported in `RateLimit-*` headers.

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
   runs on Fluid compute. There is no build command, but the server project
   **must** set `VERCEL_EXPERIMENTAL_BACKENDS=1` (see below): Vercel's default
   Hono pipeline transpiles each `.ts` file to `.js` one at a time without
   rewriting imports, so the emitted `index.js` still asks for `./config.ts`
   and the workspace packages' `exports` still point at `./src/index.ts` —
   files that no longer exist. The build goes green and the function then
   dies on its first request with `FUNCTION_INVOCATION_FAILED`. The flag
   switches the pipeline to esbuild bundling, which resolves both.
3. **Variables.**
   - `server`: `VERCEL_EXPERIMENTAL_BACKENDS=1` (required, see step 2), then
     `CORS_ORIGINS`, `DATABASE_URL` (the web project's pooled string, for the
     status history — see [Configuration](#configuration)) and any source
     tokens from `.env.example` as needed.
     `PORT` and `HOST` do not apply; Vercel owns the listener, and a
     non-integer `PORT`, `RATE_LIMIT_PER_MINUTE` or `CACHE_MAX_ENTRIES` throws
     at load.
   - `web`: `NEXT_PUBLIC_MCP_BASE_URL` and `MCP_SERVER_URL`, both the server
     project's production URL. The first is inlined at build time, so redeploy
     `web` if that URL ever changes. Plus `DATABASE_URL` (Neon's pooled
     string) and `REQUEST_HASH_SALT` for `/country` — see [Database](#database) —
     and `CRON_SECRET` for the status cron.

One dev dependency exists for Vercel's sake: `apps/server` lists `undici-types`
because Vercel type-checks the entry with a resolver that does not follow
pnpm's symlinks, so without it `@types/node` cannot reach the package that
gives `Response` its members and the build fails on `c.res.status`. The pnpm
version needs nothing extra — Vercel reads the root `packageManager` pin.

What is different on Vercel: there is no boot, so `warm` never runs. A fresh
instance fills the Diavgeia register (~19 s, held by Diavgeia and ΚΗΜΔΗΣ
each), the Mitos facet index (~4 s) and the lists of publishing bodies on
data.gov.gr (~8 s) and the Athens portal (~3 s) on the first call that needs each and
holds them for as long as the instance
lives, which a lightly used server will feel on the first organisation search
or life-event filter after a quiet spell. The in-memory rate limiter
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

The version the footer shows, `v.1.{countries}.{commits}`, and the changelog
behind it come from `apps/web/data/changelog.ts`, written by hand: one entry at
the top, in the same commit as the change it describes. `countries` is how many
have a source mounted, and `commits` is what `git rev-list --count HEAD` will
say once that commit exists. Nothing generates the file, so the page never
needs a commit of its own.

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

`packages/sources/gr/mitos` is the reference shape for a source written against
a bespoke upstream API: a `client.ts` over the portal, one `tools.ts` entry per
question it answers, and the licence in `meta.ts`.

A source over a platform many publishers run — CKAN today — is the shared
adapter instantiated for one portal: `packages/sources/gr/datagov` is
`createCkanTools` from `packages/ckan` plus a `meta.ts` and the portal's
address, licence default and examples. A second CKAN is the same few lines.

## Configuration

Copy `.env.example` to `.env`. Everything has a working default except the
per-source API tokens, and a source with missing credentials fails with a clear
message rather than breaking the server.

### Logging

The server writes one JSON object per line to stdout. Every line carries
`time`, `level`, `message` (the event) and `service`; every line written while
answering a request also carries `requestId`, the same value the caller gets
back as `x-request-id`, so one request's lines can be pulled together in any
log viewer. Lines from a call carry `transport` (`mcp` or `api`) and `mount`
(`gr` for the country server, `gr/vies` for a source's own), and `probe: true`
when the status page's check made the call.

| event | level | when |
|---|---|---|
| `request` | info | Every HTTP request: method, path, status, duration, the caller's address and user agent. On an MCP mount also `rpcMethod` — `initialize`, `tools/list`, `tools/call` — with the client's name and version on `initialize`, and for a `tools/call` the `source` and `tool` it resolved to; a qualified name on the country server is resolved to the registry that answers it. |
| `tool.ok` | info | The handler returned: `source`, `tool`, `args`, `durationMs`, `resultBytes`, and `cache` (`gets` and `hits`). Logged as a warning with `slow: true` past `LOG_SLOW_TOOL_MS`. |
| `tool.failed` | info · warn · error | The handler threw. `error` carries the `AgoraError`'s `code`, `status`, `retryable`, `details` and `cause`; a stack only when the error was not one a source throws on purpose. `warn` for an upstream that is down, rate-limiting or unconfigured; `info` for `not_found` and `invalid_input`, which are the caller's; `error` for anything unexpected. |
| `tool.aborted` | info | The caller disconnected before the handler finished. |
| `tool.rejected` | info | A call refused before any handler ran: on an MCP mount an unknown tool name or arguments the schema would not take, on the API a query or body that failed strict validation. `reason` is the message the caller was sent. |
| `request.rejected` | warn | The MCP transport refused the request itself — the wrong `Accept` or `Content-Type`, a body that is not JSON — and its own 4xx was sent. |
| `mcp.protocol_error` | warn | The MCP SDK reported an error of its own, such as a reply it could not send. |
| `record.failed` | warn | A call's outcome could not be written to the database (below). |
| `tool.start` | debug | The handler is about to run, with the arguments. Off at the default level; its one use is to leave a trace of a call the host kills before the outcome line is written. |

`LOG_LEVEL` sets the threshold (`debug`, `info`, `warn`, `error`, `silent`).
`LOG_SLOW_TOOL_MS` (default 10000) is the slow threshold. `LOG_TOOL_ARGS`
(default on) puts the validated arguments on the `tool.*` lines, cut to a
preview past 2 KB; turn it off where the log store must not hold personal
data — a VAT number is personal data for a sole trader.

### Call records and the status history

With `DATABASE_URL` set on the server, every finished call also becomes one
row in the web app's `tool_calls` table (`apps/web/db/migrations`): when,
which source and tool, the transport, whether the handler returned, the
error's code when it did not, the duration and the request id. Never the
arguments and never an address. The insert runs off the response path and a
failure is a `record.failed` line, never a failed call.

`/status` reads those rows as each source's last 90 days. Beside the real
calls, the web app's cron (`apps/web/vercel.json`, every ten minutes, at
`/api/cron/status`, let in by `CRON_SECRET`) makes one call per registry
through the public API the way the page itself does and writes the outcome as
a `probe` row, so a quiet day is not a blank one and a stretch when the server
itself was unreachable is recorded as one. The same cron drops rows older than
90 days. A check the page or the cron makes is sent with `x-agoramcp-probe`,
which the server logs but does not record — the cron writes that row itself.

## Licensing

The code is one thing, the data is another. Every source carries its upstream
licence and attribution in `meta.ts`; those strings are surfaced in the server's
MCP instructions, on `GET /`, and on every HTTP API response, so attribution
travels with the data.
