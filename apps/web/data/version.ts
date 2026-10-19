import { changelog, type ChangelogEntry } from "./changelog";

/**
 * The version the site is at, and the changelog entry it belongs to.
 *
 * One reading, shared by the footer and the changelog page, so the number in
 * the corner of every page and the number at the top of that list cannot
 * disagree — which is the whole reason this is a module and not two lookups.
 *
 * Both come from the top of `data/changelog.ts`, which is written by hand and
 * committed with the change it describes. So the newest entry is the version
 * being served: `v.{major}.{countries}.{commits}`, whose last part is the
 * number of non-merge commits in the repository, counting the one the entry
 * shipped in.
 */
export function currentRelease(): ChangelogEntry | null {
  return changelog[0] ?? null;
}

/** The version on its own. Null while the changelog is empty. */
export function currentVersion(): string | null {
  return currentRelease()?.version ?? null;
}
