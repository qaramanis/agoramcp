import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectForScripts } from "./client";
import { loadLocalEnv } from "./env";

/**
 * Writes `data/changelog.ts` — every commit in this repository, newest first,
 * each carrying the version the project was at when it landed.
 *
 * The page it feeds is static, so both halves of an entry are resolved here,
 * where git and the database are both to hand: the commits from the checkout
 * this runs in, and the version parts from the `versions` table `pnpm
 * db:version` writes. A deployment then needs neither.
 *
 * The version for a commit is `v.{major}.{countries}.{n}`, where `n` is that
 * commit's own count — the same number `db:version` records — and major and
 * countries come from the newest recorded version at or before it. Commits
 * older than the first recorded version take that first row's parts: those
 * counts are what they were, they were simply not written down yet.
 *
 *   pnpm db:version      record the current version
 *   pnpm db:changelog    then rebuild the page's data from it
 */

/** Where the generated module goes, relative to this file. */
const OUTPUT = join(import.meta.dirname, "..", "data", "changelog.ts");

/** Unit and record separators: neither can occur in a commit message. */
const UNIT = "\x1f";
const RECORD = "\x1e";

/**
 * Lines a commit message ends with that a changelog has no use for — the
 * co-author and session trailers, and the generated-with line. Matched at the
 * start of a line, after trimming.
 */
const TRAILERS = [
  /^co-authored-by:/i,
  /^claude-session:/i,
  /^signed-off-by:/i,
  /^🤖 generated with/i,
  /^https:\/\/claude\.ai\/code\/session_/i,
];

type Commit = { sha: string; date: string; subject: string; body: string[] };

/** One row of `versions`, as far as the version rule needs it. */
type Version = { major: number; countries: number; commits: number };

async function main(): Promise<void> {
  const commits = readCommits();
  if (commits.length === 0) throw new Error("git log returned no commits.");

  loadLocalEnv();
  const sql = connectForScripts();
  let versions: Version[];
  try {
    versions = await sql<Version[]>`
      select major, countries, commits from versions order by commits asc`;
  } finally {
    await sql.end();
  }

  if (versions.length === 0) {
    throw new Error("No versions recorded — run `pnpm db:version` first.");
  }

  // `readCommits` returns newest first, so the oldest commit is number one.
  const entries = commits.map((commit, index) => ({
    commit,
    number: commits.length - index,
  }));

  const file = render(
    entries.map(({ commit, number }) => ({
      version: versionAt(number, versions),
      title: commit.subject,
      body: commit.body,
      date: commit.date,
      sha: commit.sha,
    })),
  );

  writeFileSync(OUTPUT, file, "utf8");
  console.log(
    `Wrote        data/changelog.ts — ${commits.length} commits, ` +
      `${versionAt(commits.length, versions)} down to ${versionAt(1, versions)}`,
  );
}

/**
 * The version a commit landed at. The count is the commit's own; the rest is
 * read off the newest version recorded at or before it, and off the first row
 * for anything older than that.
 */
function versionAt(number: number, versions: Version[]): string {
  let held = versions[0];
  for (const version of versions) {
    if (version.commits > number) break;
    held = version;
  }
  return `v.${held.major}.${held.countries}.${number}`;
}

/** Every commit reachable from HEAD, newest first. */
function readCommits(): Commit[] {
  const log = git(
    "log",
    `--pretty=format:%H${UNIT}%ad${UNIT}%s${UNIT}%b${RECORD}`,
    "--date=short",
  );

  return log
    .split(RECORD)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, date, subject, body] = record.split(UNIT);
      return {
        sha,
        date,
        // Some subjects carry the wrapping of the terminal they were typed
        // in; a heading is one line however it was written.
        subject: subject.replace(/\s+/g, " ").trim(),
        body: paragraphs(body ?? ""),
      };
    });
}

/**
 * A commit body as paragraphs. Messages are hard-wrapped for a terminal, so
 * the lines within a paragraph are joined back up — a break every seventy-two
 * characters is the width of somebody's editor, not part of the sentence.
 */
function paragraphs(body: string): string[] {
  const kept = body
    .split("\n")
    .filter((line) => !TRAILERS.some((trailer) => trailer.test(line.trim())));

  return kept
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** One git command, run in this checkout, its output trimmed. */
function git(...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1_024 * 1_024,
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

type Entry = {
  version: string;
  title: string;
  body: string[];
  date: string;
  sha: string;
};

/** The generated module, formatted the way the repository writes data files. */
function render(entries: Entry[]): string {
  const rows = entries
    .map((entry) =>
      [
        "  {",
        `    version: ${JSON.stringify(entry.version)},`,
        `    title: ${JSON.stringify(entry.title)},`,
        `    body: [${entry.body.map((line) => `\n      ${JSON.stringify(line)},`).join("")}${
          entry.body.length > 0 ? "\n    " : ""
        }],`,
        `    date: ${JSON.stringify(entry.date)},`,
        `    sha: ${JSON.stringify(entry.sha)},`,
        "  },",
      ].join("\n"),
    )
    .join("\n");

  return `/**
 * Every commit in this repository, newest first, each with the version the
 * project was at when it landed.
 *
 * Generated by \`pnpm db:changelog\` from git and the \`versions\` table — do
 * not edit. Rerun it after \`pnpm db:version\`, and the page follows.
 */

export type ChangelogEntry = {
  /** \`v.{major}.{countries}.{commits}\`, as the footer writes it. */
  version: string;
  /** The commit subject. */
  title: string;
  /** The rest of the message, one string per paragraph, unwrapped. */
  body: string[];
  /** The commit date, ISO 8601. */
  date: string;
  /** The full commit hash. */
  sha: string;
};

export const changelog: ChangelogEntry[] = [
${rows}
];
`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
