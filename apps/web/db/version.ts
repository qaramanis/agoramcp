import { execFileSync } from "node:child_process";
import { connectForScripts } from "./client";
import { loadLocalEnv } from "./env";

/**
 * Records the version the footer shows — `v.{MAJOR}.{countries}.{commits}` —
 * as a row of `versions`. Each count comes from where it is kept: countries
 * from the `countries` table, where the seeder marks them supported, and
 * commits from the checkout this runs in. Run it after pushing, so the count
 * is the one GitHub shows. A row is a version that moved, not a run: with
 * nothing changed, nothing is written.
 *
 *   pnpm db:version    record the current version, if it is new
 */

/** Bumped by hand, when the shape of the thing changes rather than its size. */
const MAJOR = 1;

/** A row of `versions`, as far as the comparison needs it. */
type Version = { version: string; major: number; countries: number; commits: number };

async function main(): Promise<void> {
  const commits = Number.parseInt(git("rev-list", "--count", "HEAD"), 10);
  const sha = git("rev-parse", "HEAD");

  loadLocalEnv();
  const sql = connectForScripts();
  try {
    const [supported] = await sql<{ countries: number }[]>`
      select count(*)::int as countries from countries where supported`;
    const countries = supported?.countries ?? 0;

    const [latest] = await sql<Version[]>`
      select version, major, countries, commits from versions order by id desc limit 1`;
    if (latest && latest.major === MAJOR && latest.countries === countries && latest.commits === commits) {
      console.log(`Nothing to record — ${latest.version} is current.`);
      return;
    }

    const [recorded] = await sql<{ version: string }[]>`
      insert into versions (major, countries, commits, commit_sha)
      values (${MAJOR}, ${countries}, ${commits}, ${sha})
      returning version`;
    console.log(
      `Recorded     ${recorded?.version} — ${countries} countries, ${commits} commits at ${sha.slice(0, 7)}` +
        (latest ? `, was ${latest.version}` : ""),
    );
  } finally {
    await sql.end();
  }
}

/** One git command, run in this checkout, its output trimmed. */
function git(...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
