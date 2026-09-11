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
    version: "v.1.1.18",
    title: "Give the catalogue the Dashboard's row in the nav",
    body: [
      "The Product dropdown's Dashboard placeholder — two thirds of it the catalogue, the rest usage that would need accounts — is now Catalogue: a row to `/all` with a `Library` icon, and \"all sources\", \"registries\" and \"directory\" as its search keywords. The footer's Product column makes the same swap, so the catalogue is linked from the footer for the first time.",
      "The Resources dropdown drops its \"View all\" card, whose destination the new row covers. \"Request a country\" is the one card left and stands the full height of the four rows beside it — the column's flex layout already did that once the card had no sibling.",
    ],
    date: "2026-09-11",
  },
  {
    version: "v.1.1.17",
    title: "Replace the landing page's placeholder sections with the four that ship",
    body: [
      "The Sources subtext now counts what the server has mounted, read through `loadDirectory` the way `/all` reads it, so it moves when a source is mounted rather than when a logo is added; the page renders per request (`revalidate = 0`) for the same reason `/all` does, and the sentence stands without the number when the server is unreachable.",
      "`components/use-cases/worked-question.tsx` and `question-tabs.tsx` turn the Tools placeholder into Questions: the four use cases of `data/use-cases.ts` as a vertical tab list on four of the page's columns, and the selected one worked through on the last five — the prompt as typed, the tools it calls in order, the registries that answer it, and links to the walkthrough and `/live`. Every panel is rendered and stacked in one cell so nothing moves when the selection changes; the panel fades out and back in over 300 ms, the list numbers its rows itself (`Example 1:` and on) so the data keeps plain titles, and the arrow keys move through the list.",
      "`components/attribution/attribution.tsx` turns the Attribution placeholder into three facts on the same four-one-five columns: official registries only, answering right now, and the licence that travels with the data, the last shown as the HTTP envelope excerpt built from `data/licenses.ts` with Diavgeia's attribution line verbatim. `components/exit/exit.tsx` closes the page with a hero-sized \"Connect to Agora now\" and one Get started button to `/quickstart`, centred on the content width with twice the standard band's padding — the one band that does not lay out on the columns.",
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
