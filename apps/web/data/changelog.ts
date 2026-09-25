/**
 * What changed in agoramcp, newest first, written by hand.
 *
 * Add an entry at the top in the same commit as the work it describes — the
 * page ships with the change and never needs a commit of its own. Nothing
 * generates this file.
 *
 * The version is `v.{major}.{countries}.{commits}`, the number the footer
 * shows. `commits` is how many the repository will hold once the commit
 * carrying the entry exists: `git rev-list --count HEAD` plus one.
 * `countries` is how many have a source mounted, and moves when one is
 * added. `major` is bumped by hand, when the shape of the thing changes
 * rather than its size.
 *
 * The top entry is the current version; `data/version.ts` reads it for the
 * footer and the changelog page.
 */

export type ChangelogEntry = {
  /** `v.{major}.{countries}.{commits}`, as the footer writes it. */
  version: string;
  /** One line, the heading of the entry. */
  title: string;
  /** The rest, one string per paragraph. Backticks render as code. */
  body: string[];
  /** The day it landed, ISO 8601 (`YYYY-MM-DD`). */
  date: string;
};

export const changelog: ChangelogEntry[] = [
  {
    version: "v.1.1.34",
    title: "Put a deadline on every tool call and bound the PDF reads",
    body: [
      "A handler makes several upstream requests, each with its own timeout and two retries, so nothing capped a call as a whole: a slow registry could hold one for minutes after the caller's client had given up. `callTool` now gives every call a deadline, `TOOL_TIMEOUT_MS` (60 s by default, about where MCP clients give up), and hands the handler a signal that aborts on it as well as on the caller leaving. A call cut off by it is answered as a retryable `upstream_timeout` naming the registry, on the API and over MCP; a caller who left first is still only noted as `tool.aborted`.",
      "Diavgeia's and ΚΗΜΔΗΣ's PDF downloads checked the declared length and then read the whole body before checking again, so a response with no length was held whole whatever its size. They now read through `readCapped` and stop at 30 MB as the bytes arrive. Their text is read by `pageTexts`, new in `packages/core/src/pdf.ts`, one page at a time where unpdf started every page at once: the signal is checked before each page, so extraction stops when the call does, and other requests get a turn between pages. On a 19-page Diavgeia decision and a ΚΗΜΔΗΣ payment the text is identical to unpdf's, character for character.",
      "The web app's read of the server's registry had no timeout, so every page that renders it could hang on a server that accepted the connection and never answered. It now gives up after 10 s with a message, racing the fetch rather than aborting it, since an abort signal would stop Next memoising the one call a page's views share. Five new tests cover the deadline, a caller leaving, and `pageTexts`.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.33",
    title: "Make the database scripts ask before they drop anything, and run one at a time",
    body: [
      "`db:rollback` and `db:reset` ran the moment they were typed, against whatever `.env.local` named, and the one on the machine these were written on names production. They now list the migrations they would reverse and go on only when the database's name is typed back; a wrong name, or Ctrl+D, reverses nothing. `--force` skips the question, and without a terminal to ask in nothing is reversed without it. Every script run now opens with the database it reached, host and name, never the credentials.",
      "Two runs against one database could interleave: two `db:migrate`s both finding the same migration pending, or both making the `migrations` table. Every migration and seed run now holds a Postgres advisory lock for as long as it runs, taken with `pg_try_advisory_lock` in `db/client.ts`, so the second is turned away at once with a message rather than left to fail half-way. The scripts' one session is no longer closed for being idle, so the lock survives a confirmation left waiting. Checked against a throwaway Postgres 17: two migrations started together end with one migrated and one refused. The README's Database section says how to run a `down` against a database of your own.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.32",
    title: "Add the first tests: 136, offline, in under four seconds",
    body: [
      "There were none. `pnpm test` now runs every `*.test.ts` in the workspace on Node's own test runner under `tsx`, the way the server runs, so there is no build and no framework: `tsx` joins the root's dev dependencies and nothing else is added. Tests sit beside the code they cover, and none reaches a registry. HTTP clients are tested against a server the test starts, and `apps/server/src/app.test.ts` drives the whole app through `app.fetch` in memory.",
      "`packages/core` is covered where it guards: `fetchUntrusted` refusing loopback, private and metadata addresses in every spelling while its trap server counts zero requests, `readCapped` stopping at the cap without pulling the rest, the HTTP client's retries, timeouts and error mapping, the cache's size budget, LRU order and TTL, `withCache` sharing a load and recovering from a starter's abort, and the requester id. `packages/ckan` gets its CSV and JSON readers and a fake CKAN that checks every Solr filter value is quoted and escaped; VIES its ΑΦΜ check digit and number forms; Diavgeia its Lucene query builder and calendar arithmetic; NOA its time windows and catalogue parser.",
      "The server's tests pin down this week's fixes: JSON-RPC batches refused, bodies over 64 KB refused on both doors, a handler's details kept from API callers, the rate limit per requester and per source with the /live proxy's visitor sharing the budget they spent directly and a forged requester ignored, request ids kept or replaced, and no argument on a log line unless `LOG_TOOL_ARGS` is on. Undoing four of those fixes one at a time fails the suite each time. The README says how the tests are laid out.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.31",
    title: "Send security headers from every page of the site",
    body: [
      "The site sent HSTS, which Vercel adds, and `X-Powered-By`, and nothing else. `next.config.ts` now sends a Content Security Policy on every response that names no origin but the site's own, because everything it loads is its own: fonts self-hosted by `next/font`, images from `public/`, Vercel Web Analytics from `/_vercel/insights`, and the /live console's calls to `/api/mcp`. Plugins, `<base>`, forms posting elsewhere and framing are refused, the last also by `X-Frame-Options: DENY` for older browsers.",
      "Inline scripts and styles are allowed. The App Router streams its payload in inline scripts, and the other way, a nonce per request, would render every page on demand, including the eight that are prerendered now; the site renders no one else's HTML, so an injected inline script is the one thing given up. Development adds `'unsafe-eval'` for React's dev build and the analytics debug script from Vercel's CDN.",
      "Alongside it: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off the camera, microphone, location, payments, USB and topics, and `Cross-Origin-Opener-Policy: same-origin`. `poweredByHeader: false` drops `X-Powered-By`. Every route was loaded in Chrome under the policy, in the production build and in development, with no violation: the WebGL eclipse and starfield draw, the fonts load, and the console answers.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.30",
    title: "Fix six small failures in how the server answers and fails",
    body: [
      "Concurrent misses on one cache key share the first caller's load, which runs on that caller's abort signal, so a caller who hung up failed everyone waiting on it, and each of them was logged as an `internal` error. `withCache` now has a waiter whose shared load aborted load again as itself; a real failure is still shared, not retried.",
      "Four caller mistakes were plain `Error`s and came back as 500s: a date range whose start is after its end, in Diavgeia and ΚΗΜΔΗΣ, and a `fromPage` past the end of a PDF, in both. They are `invalid_input` now, and ΚΗΜΔΗΣ's fallback for a record with no PDF is `not_found`, as its documentation already said. With every deliberate failure an `AgoraError`, anything else is a bug: `toolErrorMessage` answers it with a generic message quoting the request id, on the API and to the model alike, rather than with a message written for us.",
      "`getJson` returned `undefined` for an empty body, which every caller then read a property of; it is an `upstream_error` now. `list_facets` on the CKAN portals parses a facet's JSON list through the guarded `terms` in `vocab.ts` instead of a bare `JSON.parse`.",
      "The MCP mounts and the tool API refuse a body over 64 KB, with a JSON-RPC error or `payload_too_large` 413, counted by the stream when the request declares no length. A caller's `x-request-id` is kept only when it looks like an id (up to 128 letters, digits and `._:-`) and replaced otherwise, since it goes on every log line and into `tool_calls`. `/api`, the README and the two sources' error tables say so.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.29",
    title: "Stop sending a failure's internal details to API callers",
    body: [
      "An HTTP API error carried the `AgoraError`'s `details` verbatim, and a handler's details are written for the log: the full upstream URL, the first 500 bytes of the upstream's raw reply, the query as it was built, data.gov.gr's Solr error with the parameters it ran. Nothing secret went out, since no source uses a key yet, but the day one puts a token in a URL it would have gone out on the first failure. The MCP mounts never sent them.",
      "`apiError` in `apps/server/src/api.ts` now sends `details` only when it is handed them, which is only for a 400 the request's own validation refused: `issues`, naming each field, as the example on `/api` has always shown. Every other failure is its code, message and whether to retry. The README's HTTP API section says so.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.28",
    title: "Identify a requester the same way on the site and the server",
    body: [
      "`requesterId` in `packages/core/src/requester.ts` is now the one definition of who is asking: an HMAC-SHA256 of the client's address keyed by `REQUEST_HASH_SALT`, an IPv6 address by its /64 (a household picks addresses inside it at will) and an IPv4-mapped one as its IPv4. The user agent is no longer part of it, since a caller sets that header itself and a new one made a new person. The web app imports the file as `@agoramcp/core/requester`, its first workspace dependency, compiled through `transpilePackages`.",
      "The `/country` form files requests under it, so changing browser no longer buys a second vote. Hashes filed before this change were made the old way and no longer match, so each earlier requester can ask for each country once more. The server's rate limiter counts under it too, given the same salt, instead of the raw address.",
      "The `/live` proxy reaches the server from the site's own address, which put every visitor on one budget, and made the site a way around a spent one. It now sends the visitor's id in `x-agoramcp-requester`, with `x-agoramcp-proxy` carrying `PROXY_SECRET` to prove it is the site; the server believes the id only beside the secret, compared in constant time. One person now has one budget per source across the API, the MCP mounts and the playground. `/privacy` says the hash is of the address alone and that the rate limit counts it, and the README gains a Requesters section and the two variables for each project.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.27",
    title: "Add the mobile navigation menu",
    body: [
      "Below the `md` breakpoint the nav had only the logo. It now has the hamburger menu from bloom.ai, the same reference the desktop pill was copied from: a Squash toggle from `hamburger-react` slides a full-width panel in from the right over a blurred backdrop. Product, Use cases and Resources open as an accordion, one at a time, and a Connect button to `/quickstart` sits at the bottom. The panel locks the page's scroll while open and closes on a link, an outside tap or Escape.",
      "The mobile menu has no cover-image cards. Quickstart, View live and Request a country are plain links under their headings, after the rows the desktop panel lists beside them. The menu lives in `components/navigation/navigation-mobile.tsx`.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.26",
    title: "Keep addresses and argument values out of the server's logs",
    body: [
      "`/privacy` promises that the server logs what was asked, not who asked, and never the arguments. The code had drifted from that: every `request` line carried the caller's address and user agent, and `LOG_TOOL_ARGS` was on by default, so a VAT number or a name searched for in Diavgeia went into the log store with every call. The `request` line now carries neither the address nor the user agent; the address is still read, by the rate limiter alone, and held for its minute.",
      "`LOG_TOOL_ARGS` now defaults to off, and the `tool.*` lines carry `argNames`, the names of the validated arguments, instead of their values. A failed call's line keeps the error's name, code, status and whether it is worth retrying, but not its message or details, which quote what was asked (the ΑΔΑ not found, the upstream URL with the VAT number in its path). An error no source throws on purpose keeps its message and stack. Setting `LOG_TOOL_ARGS=true` brings the values and the full error back for debugging. The README and `.env.example` say so, and the privacy page moves its date.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.25",
    title: "Refuse JSON-RPC batches on the MCP endpoints",
    body: [
      "The MCP transport ran every message of an array body at once, behind one request the rate limiter counted once, so a single POST could make any number of tool calls against a budget of 60 a minute. MCP dropped batches in its 2025-06-18 revision. `runServer` in `apps/server/src/index.ts` now answers an array with a 400 and JSON-RPC error `-32600` before the transport sees it, logged as `request.rejected` with the batch's length. Single messages are unchanged, and a refused batch still counts against the limit.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.24",
    title: "Refuse non-public addresses in read_resource and cap what it holds",
    body: [
      "`read_resource` fetched a resource's link with a plain `fetch`: any host the publisher named, redirects followed anywhere, and the whole body read before the 8 MB check. It now goes through `fetchUntrusted` in `packages/core/src/untrusted.ts`, built on `node:http` with a guarded `lookup`. Only http and https are fetched, and every address it connects to, after DNS and on each of up to five redirects, must be on the public internet. A link to a private, loopback or link-local address is refused as `invalid_input` without being fetched.",
      "`readCapped` in `packages/core/src/http.ts` counts the body as it arrives, after decompression, and stops at the cap, so a file sent with no length, or a small compressed one that inflates to hundreds of megabytes, is refused at 8 MB. The memory cache now evicts by size as well as by count, under `CACHE_MAX_MB` (default 256), since one entry can be a whole file. The datagov `DOCUMENTATION.md` describes the new refusal.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.23",
    title: "Mark the selected question with a chevron",
    body: [
      "Each title in the Questions list of `components/use-cases/question-tabs.tsx` now starts with lucide's `ChevronRight`, in the title's own colour. The selected title sits one chevron and gap to the right; a deselected one slides back left by that width, so its text lines up with the heading and its chevron fades out in the gutter. Only the chevron fades: the title moves with it and keeps its opacity. The slide, the fade and the title's colour share one 500 ms ease-out, where the colour alone used to take 300 ms.",
    ],
    date: "2026-09-25",
  },
  {
    version: "v.1.1.22",
    title: "Count page views with Vercel Web Analytics",
    body: [
      "`app/layout.tsx` mounts `Analytics` from `@vercel/analytics/next` at the end of the body, so every page load and client-side transition is counted once Web Analytics is enabled for the web project in the Vercel dashboard. The package was already a dependency; nothing had loaded it. The script is served from the site's own origin at `/_vercel/insights/script.js`, does nothing in development, and sets no cookie.",
      "`/privacy` no longer says the site runs no analytics. Its lead, its summary and its Browsing section now say that page views are counted and, from Vercel's own privacy page, what a page view records: the moment, the path, the referrer, the country, region and city, browser, operating system and device type, with a request hash kept for a day at most and no cookie. `data/legal.ts` moves its date.",
    ],
    date: "2026-09-22",
  },
  {
    version: "v.1.1.20",
    title: "Log every tool call in full and give the status page its last 90 days",
    body: [
      "The server's `request` line now says what a POST to a mount was: the JSON-RPC method, the client's name and version on `initialize`, and for a `tools/call` the registry and tool behind it (a qualified name on the country server is resolved to the source that answers). `callTool` writes one `tool.ok` or `tool.failed` line per call carrying the same `requestId`, with transport, mount, arguments, duration, result size and cache hits; a failure carries the `AgoraError`'s code, status, details and cause, at a level that says whose fault it was. Calls the SDK refuses before any handler runs (an unknown tool, arguments the schema will not take) and the transport's own 406/415/bad-JSON refusals, which used to become 500s, each get a line of their own. `LOG_SLOW_TOOL_MS` and `LOG_TOOL_ARGS` are new, both documented in the README.",
      "With `DATABASE_URL` set, the server also records each finished call as a row in `tool_calls` (`apps/server/src/record.ts`, a migration in `apps/web/db/migrations`): source, tool, transport, outcome, code and duration, never the arguments or an address. `apps/web/vercel.json` schedules `/api/cron/status` every ten minutes, which makes the page's own check per registry and writes it as a `probe` row, so a quiet day is not a blank one and a stretch when the server itself was down is recorded as one; the same run drops rows older than 90 days. `CRON_SECRET` lets it in.",
      "`/status` keeps its live verdict and adds, under each registry, `components/status/history-strip.tsx`: ninety cells for ninety days, green for a day that answered, the site's one warning colour at half strength for a day that missed more than one call in a hundred and full for more than one in four, the panel border for a day nothing was asked, with the count in each cell's title and the window's share answered beneath. `data/status.ts` shapes the rows for it and sends `x-agoramcp-probe` on every check, which the server logs but does not record.",
    ],
    date: "2026-09-12",
  },
  {
    version: "v.1.1.19",
    title: "Build the footer from the nav and add the Privacy and Terms pages",
    body: [
      "`data/footer.ts` now builds its Product and Resources columns from the nav's own panels, rows then cards, the way `useCaseItems` is built from `data/use-cases.ts`, so the two cannot drift. View live moves to Product and Licences joins Resources as a result.",
      "Legal is down to Privacy and Terms, each now a page: `/privacy` says what the site and the servers see and keep, `/terms` whose data it is and what is promised. Both are text in `data/legal.ts` rendered by `components/legal/legal-page.tsx`, with the hero and band of `/licenses`. Attribution and Licences leave the column; the licences page is under Resources.",
      "The Contact column is commented out, in the footer and in the search index, until it has real destinations. `formatDay` moves to `data/format.ts` for the legal pages' last-updated line.",
    ],
    date: "2026-09-12",
  },
  {
    version: "v.1.1.18",
    title: "Give the catalogue the Dashboard's row in the nav",
    body: [
      "The Product dropdown's Dashboard placeholder (two thirds of it the catalogue, the rest usage that would need accounts) is now Catalogue: a row to `/all` with a `Library` icon, and \"all sources\", \"registries\" and \"directory\" as its search keywords. The footer's Product column makes the same swap, so the catalogue is linked from the footer for the first time.",
      "The Resources dropdown drops its \"View all\" card, whose destination the new row covers. \"Request a country\" is the one card left and stands the full height of the four rows beside it. The column's flex layout already did that once the card had no sibling.",
    ],
    date: "2026-09-11",
  },
  {
    version: "v.1.1.17",
    title: "Replace the landing page's placeholder sections with the four that ship",
    body: [
      "The Sources subtext now counts what the server has mounted, read through `loadDirectory` the way `/all` reads it, so it moves when a source is mounted rather than when a logo is added; the page renders per request (`revalidate = 0`) for the same reason `/all` does, and the sentence stands without the number when the server is unreachable.",
      "`components/use-cases/worked-question.tsx` and `question-tabs.tsx` turn the Tools placeholder into Questions: the four use cases of `data/use-cases.ts` as a vertical tab list on four of the page's columns, and the selected one worked through on the last five, with the prompt as typed, the tools it calls in order, the registries that answer it, and links to the walkthrough and `/live`. Every panel is rendered and stacked in one cell so nothing moves when the selection changes; the panel fades out and back in over 300 ms, the list numbers its rows itself (`Example 1:` and on) so the data keeps plain titles, and the arrow keys move through the list.",
      "`components/attribution/attribution.tsx` turns the Attribution placeholder into three facts on the same four-one-five columns: official registries only, answering right now, and the licence that travels with the data, the last shown as the HTTP envelope excerpt built from `data/licenses.ts` with Diavgeia's attribution line verbatim. `components/exit/exit.tsx` closes the page with a hero-sized \"Connect to Agora now\" and one Get started button to `/quickstart`, centred on the content width with twice the standard band's padding, the one band that does not lay out on the columns.",
      "The root layout marks `<html>` with `data-scroll-behavior=\"smooth\"`, which Next asks for before it honours the `scroll-behavior: smooth` in `globals.css` on navigation.",
    ],
    date: "2026-09-10",
  },
  {
    version: "v.1.1.16",
    title: "Rewrite every changelog entry from its commit's diff",
    body: [
      "Every entry below now describes what its commit changed, read from the diff rather than copied from the message: specific titles in place of \"Major changes\" and \"ui/ux updates\", and bodies that name the packages, tools, routes and scripts involved. Tool counts were checked against the tools files at those commits.",
    ],
    date: "2026-09-08",
  },
  {
    version: "v.1.1.15",
    title: "Keep the changelog by hand and drop the versions table",
    body: [
      "Delete `db/changelog.ts` and `db/version.ts`, the scripts that wrote this page from `git log` and recorded commit counts in a `versions` table, along with their `pnpm db:*` entries. A migration drops the table; its `down` recreates it.",
      "`data/changelog.ts` is now written by hand and committed with the change it describes, and the `sha` field is gone. The footer and this page still read its top entry, so the `v.{major}.{countries}.{commits}` scheme is unchanged.",
    ],
    date: "2026-09-08",
  },
  {
    version: "v.1.1.13",
    title: "Add the NOA earthquake source and generate the changelog from git",
    body: [
      "`packages/sources/gr/noa` reads the National Observatory of Athens `fdsnws-event` service with three tools: `search_earthquakes` (time, magnitude, depth, bounding box or radius), `get_earthquake`, which parses QuakeML for station count, azimuthal gap and analyst review, and `list_recent_earthquakes`. Search windows are capped at 31 days; `meta.ts` declares CC-BY-4.0 with the Institute of Geodynamics attribution and short TTLs.",
      "`pnpm db:changelog` writes `data/changelog.ts` from `git log` and the `versions` table, and `/changelog` becomes one flat list, newest first. The footer reads the version from the new `data/version.ts` instead of the database, so `loadVersion` and the layout's `revalidate = 60` go.",
    ],
    date: "2026-09-07",
  },
  {
    version: "v.1.1.12",
    title: "Fade every navigation, not only the top-level ones",
    body: [
      "The root `template.tsx` keys its fade on the full pathname, so moving between catalogue countries, sources or use cases animates like moving between top-level pages. Search-parameter changes are left out, so the live console can rewrite its query without a blink.",
    ],
    date: "2026-09-07",
  },
  {
    version: "v.1.1.11",
    title: "Add the VIES source and the pages the nav pointed at",
    body: [
      "`packages/sources/gr/vies` replaces the `gr/test` placeholder: `check_vat_number` normalises an ΑΦΜ, validates its check digit and asks the EU VAT Information Exchange System, and `list_member_states` reports which member states are answering. With `gr/test` gone, `UNBUNDLED` is empty and VIES joins the Greek country server.",
      "Four dead nav links become pages: `/documentation` (glossary, conventions and a route index from `data/documentation.ts`), `/status` (one live call per mounted registry), `/licenses` (sources grouped by licence with their attribution lines) and `/changelog`. The Features dropdown becomes Use cases, each row of `data/use-cases.ts` rendering at `/use-cases/[slug]`.",
      "On `/all`, the Countries and Sources lists get a hero each and `CountryRow` and `SourceRow` share one `Row`. `CodeBlock` gains a `wrap` prop, `Band` an `id`, and search indexes the glossary under Vocabulary.",
    ],
    date: "2026-09-07",
  },
  {
    version: "v.1.1.10",
    title: "Add HTTP tool endpoints, a CKAN adapter and four Greek sources",
    body: [
      "The server answers plain HTTP beside MCP: `GET|POST /{country}/api/{source}/{tool}` calls a tool with query values coerced to its schema, undeclared parameters rejected with a 400, and an envelope carrying `publisher`, `license`, `attribution` and `upstreamUrl` around `data`. Both transports share `call.ts` for the credential check, TTL and logging, and successful GETs carry a `Cache-Control` matching the tool's TTL.",
      "`packages/ckan` is a reusable adapter with seven tools over any CKAN portal, reading CSV, TSV, JSON and GeoJSON resources outside the datastore. `gr/datagov` and `gr/athens` are it pointed at data.gov.gr and the City of Athens; `gr/kimdis` (public contracts) and `gr/mitos` (public-service procedures) have their own clients, seven tools each.",
      "The web app gains the catalogue at `/all`, `/all/[country]` and `/all/[country]/[source]`, rendered from the server's `GET /` with a full per-tool reference, an `/api` page documenting the HTTP contract, and a rewritten search over menu, footer, mounts, agents and error codes. A `versions` table and `db:version` script put `v.1.{countries}.{commits}` in the footer, and the README documents the API and `VERCEL_EXPERIMENTAL_BACKENDS=1` for the server project.",
    ],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.9",
    title: "Store country requests in Postgres behind a server action",
    body: [
      "`apps/web/db/` adds a `postgres` client, a Laravel-style migration runner (`migrate`, `rollback --step=N`, `reset`, `status`, `make`) with a `migrations` table, a seeder runner and migrations for `countries` and `requests`, plus the `db:*` scripts in `package.json`.",
      "The `/country` form submits to a `requestCountry` server function and reports `created`, `duplicate`, `supported`, `unknown` or `error` with the live count. A visitor is a salted SHA-256 of address and user agent (`REQUEST_HASH_SALT`), so each counts once per country; the placeholder `requestCounts` map is deleted.",
    ],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.8",
    title: "Split the server listener into serve.ts and document deployment",
    body: [
      "`apps/server/src/index.ts` now exports the Hono app; the `serve()` call and the boot-time `warm` loop move to `serve.ts`, which `dev` and `start` run, so a host that owns the listener imports the app alone. `railway.json` configures the Railpack build and `/health` check, the web `start` honours `PORT`, and the README gains a Deploying section for the two Vercel projects.",
    ],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.7",
    title: "Sort each country's sources alphabetically in the catalogue",
    body: [
      "`loadCatalogue` orders a country's providers by display name, case- and accent-insensitive, instead of the registry's import order.",
    ],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.6",
    title: "Mount per-country MCP bundles and add the /mcp and /quickstart pages",
    body: [
      "`/{country}/mcp` serves every source of a country in one server, tool names prefixed with their source; `defineBundle` in `packages/core` checks at boot that no two sources claim the same name. `Source` gains a `warm` hook run at boot and `SourceTool` an `example` parsed against its own schema.",
      "Diavgeia grows from 8 to 17 tools, among them `search_decisions_advanced`, `get_decision_text` (PDF text via `unpdf`), `get_decision_history` and `search_dictionary`, with a `warm` that prefetches the body register; `docs/gr-documentation.md` indexes them.",
      "`/mcp` and `/quickstart` print connection snippets for Claude Code, Claude, Codex, Cursor, Windsurf, VS Code and any MCP client. `/live` builds its tool list from the server's `GET /` through the new `data/catalogue.ts`, with Greek names transliterated by `data/greeklish.ts`, instead of a hand-written provider list.",
    ],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.5",
    title: "Add a page-wide WebGL starfield and make the eclipse transparent",
    body: [
      "`components/background/starfield.tsx` draws a full-page star canvas at 30fps, pausing when the tab is hidden and rendering one static frame under `prefers-reduced-motion`; it is imported in the layout but still commented out. The eclipse shader drops its own stars and emits premultiplied alpha, so the layer behind it shows through. Text selection takes the accent colour.",
    ],
    date: "2026-08-31",
  },
  {
    version: "v.1.1.4",
    title: "Add the Diavgeia source with 8 tools, the site shell and /live",
    body: [
      "`packages/sources/gr/diavgeia` reads `diavgeia.gov.gr/opendata` with `search_decisions`, `get_decision`, `list_decision_types`, `search_organizations`, `get_organization`, `list_organization_units`, `get_signer` and `list_thematic_categories`; `meta.ts` records CC-BY-4.0, the Greek attribution and per-tool TTLs, and `DOCUMENTATION.md` covers the upstream API.",
      "The web app gets its shell: `Navigation` and `Footer` in the root layout, a dark theme with one accent colour and JetBrains Mono with the Greek subset, the shared 12-column `Grid`, and a landing hero with a WebGL eclipse that tracks the cursor above a grid of publisher logos.",
      "`/live` lets a visitor pick a country, source and tool, edit the arguments and read the real response, proxied through `app/api/mcp/route.ts`, which rebuilds the arguments from `data/playground.ts` and rejects unknown endpoints or tools before forwarding. `/country` is a request-a-country form over the ISO list.",
    ],
    date: "2026-08-31",
  },
  {
    version: "v.1.1.3",
    title: "Split into a pnpm monorepo with a Hono MCP server and core package",
    body: [
      "The Next.js app moves to `apps/web`; `packages/core` holds the `Source` contract (`defineSource`, `defineTool`), an HTTP client, an in-memory cache, a logger and the `AgoraError` hierarchy for invalid input, missing credentials, not found, rate limit and upstream failure.",
      "`apps/server` is a Hono app that mounts every registered source at `/{country}/mcp/{source}` over Streamable HTTP, building a stateless `McpServer` per request, with CORS, request-id logging, a per-client rate limiter and `registry.ts` as the single wiring point. `packages/sources/gr/test` ships one `ping` tool as the reference source shape.",
    ],
    date: "2026-08-29",
  },
  {
    version: "v.1.1.2",
    title: "Strip the create-next-app template",
    body: [
      "Remove the template page, favicon and Vercel SVGs, title the app agoramcp and cut the README to the two commands that run it. `globals.css` applies the Geist font through the Tailwind theme instead of Arial.",
    ],
    date: "2026-08-29",
  },
  {
    version: "v.1.1.1",
    title: "Scaffold the web app with create-next-app",
    body: [
      "A fresh Next.js App Router project with Tailwind 4, ESLint and a pnpm workspace file, still showing the generator's template page.",
    ],
    date: "2026-08-29",
  },
];
