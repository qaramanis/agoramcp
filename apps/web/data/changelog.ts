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
    version: "v.1.1.15",
    title: "Keep the changelog by hand",
    body: [
      "Remove the generator that wrote this page from git. `pnpm db:changelog` and `pnpm db:version` are gone, and so is the `versions` table they fed: the commit that committed the generated file was itself a new entry, so every update needed another commit, which needed another update.",
      "The changelog is now `data/changelog.ts`, edited by hand and committed with the change it describes. The footer reads its top entry, so the version scheme is unchanged — the last part is still the number of commits in the repository.",
    ],
    date: "2026-09-08",
  },
  {
    version: "v.1.1.13",
    title: "Add the NOA earthquake source and generate the changelog from git",
    body: [
      "Add `packages/sources/gr/noa`: a client over the National Observatory of Athens FDSN event service, with `search_earthquakes` (time, magnitude, depth, bounding box or radius), `get_earthquake` — which reads QuakeML for the quality of the solution — and `list_recent_earthquakes`. CC-BY-4.0 and the Institute of Geodynamics attribution in `meta.ts`, short TTLs because seismicity is live. One import in `registry.ts`; documented in `docs/gr-documentation.md` and the package's `DOCUMENTATION.md`.",
      "Replace the hand-written changelog with the repository's own history: `pnpm db:changelog` writes `data/changelog.ts` from git and the `versions` table, resolving each commit's version as it goes. /changelog becomes a flat list of commits, newest first, and gets its nav, footer and documentation-index links.",
      "The footer now reads the version from `data/version.ts` instead of the database, so it and the changelog cannot disagree — dropping `latestVersion`/`loadVersion` and the layout's one-minute `revalidate`.",
    ],
    date: "2026-09-07",
  },
  {
    version: "v.1.1.12",
    title: "Animate page transitions across all routes",
    body: [],
    date: "2026-09-07",
  },
  {
    version: "v.1.1.11",
    title: "Add VIES source and the site pages the nav pointed at",
    body: [
      "Replace the placeholder `gr/test` package with `gr/vies`: a client over the EU VAT Information Exchange System with `check_vat_number` and `list_member_states`, plus its licence and documentation. It joins the Greek country server, so `UNBUNDLED` is now empty.",
      "Fill in the nav's dead links with real pages: /documentation, /status, /licenses and /changelog. The Features dropdown becomes Use cases, built from `data/use-cases.ts` so every row has a page at /use-cases/{slug}, and Resources lists the new pages instead of per-country sources.",
      "Elsewhere: section heroes on /all, glossary terms in the search index, optional wrapping on `CodeBlock` and an anchor id on `Band`.",
    ],
    date: "2026-09-07",
  },
  {
    version: "v.1.1.10",
    title: "Major changes",
    body: [
      "Add HTTP API and Greek data sources",
      "Expose plain HTTP tool endpoints, add CKAN and procurement adapters, expand the Greek source registry, and document the new catalogue and API. Improve web directory pages, search, navigation, footer versioning, and deployment configuration.",
    ],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.9",
    title: "Add Postgres-backed country request tracking",
    body: [],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.8",
    title: "Document Railway deployment setup and support dynamic web ports",
    body: [],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.7",
    title: "Sort catalogue providers alphabetically by name",
    body: [],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.6",
    title: "Add country-level MCP bundles and web quickstart guides",
    body: [],
    date: "2026-09-01",
  },
  {
    version: "v.1.1.5",
    title: "ui/ux updates",
    body: [],
    date: "2026-08-31",
  },
  {
    version: "v.1.1.4",
    title: "initial steps - first sources from Diavgeia -> Greece --- - navigation, UI, footer - landing page - live requests page - request a country page",
    body: [],
    date: "2026-08-31",
  },
  {
    version: "v.1.1.3",
    title: "initial structure setup commit",
    body: [],
    date: "2026-08-29",
  },
  {
    version: "v.1.1.2",
    title: "next cleanup",
    body: [],
    date: "2026-08-29",
  },
  {
    version: "v.1.1.1",
    title: "Initial commit from Create Next App",
    body: [],
    date: "2026-08-29",
  },
];
