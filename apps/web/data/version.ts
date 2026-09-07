import { changelog, type ChangelogEntry } from "./changelog";

/**
 * The version the site is at, and the commit it belongs to.
 *
 * One reading, shared by the footer and the changelog page, so the number in
 * the corner of every page and the number at the top of that list cannot
 * disagree — which is the whole reason this is a module and not two lookups.
 *
 * Both come from `data/changelog.ts`, which `pnpm db:changelog` writes from
 * git and the `versions` table. The newest commit's version is the current one
 * by construction: `v.{major}.{countries}.{commits}`, whose last part is the
 * number of commits behind it, and the newest commit is the one being served.
 *
 * So it moves on deploy rather than the moment `pnpm db:version` runs, which
 * is the honest thing for it to say — a version names the code answering the
 * request, not the last row somebody wrote.
 */
export function currentRelease(): ChangelogEntry | null {
  return changelog[0] ?? null;
}

/** The version on its own. Null before the first `pnpm db:changelog`. */
export function currentVersion(): string | null {
  return currentRelease()?.version ?? null;
}
