import { revalidateTag } from "next/cache";
import { checkAll, HISTORY_DAYS, STATUS_TAG } from "@/data/status";
import { knownSources, pruneToolCalls, recordProbes, type ProbeRow } from "@/db/tool-calls";

/**
 * The status monitor. Vercel calls this every ten minutes (`vercel.json`);
 * it asks each registry its source's declared probe through the public API,
 * with the web app's proof so the server skips its cache, and writes what
 * came back as `probe` rows beside the real calls the server records — so a
 * quiet day still has something to say, and a stretch when our own server
 * was down is recorded as one, which the server cannot do for itself. Then
 * it lets go of rows older than the page shows, and clears the page's cached
 * read, so the round is on the page by the next view.
 *
 * Only the cron may call it: Vercel sends the project's `CRON_SECRET` as a
 * bearer token, and nothing else knows it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Without the proof the server treats these as ordinary calls: answered
  // from its cache, and recorded as well as written here.
  if (!process.env.PROXY_SECRET?.trim()) {
    console.warn("status: PROXY_SECRET is not set, so the monitor's checks may be answered from the server's cache");
  }

  const round = await checkAll();

  // Our server could not even be asked what it mounts, so every registry
  // seen lately is unreachable through us — which is what a caller would find.
  const rows: ProbeRow[] = round.unavailable
    ? (await knownSources(HISTORY_DAYS)).map((source) => ({
        source,
        tool: "",
        ok: false,
        code: "unreachable",
        detail: round.unavailable,
        durationMs: 0,
      }))
    : round.checks.map((check) => ({
        source: check.key,
        tool: check.tool,
        ok: check.health !== "down",
        code: check.code,
        detail: check.detail,
        durationMs: check.ms,
      }));

  await recordProbes(rows);
  const pruned = await pruneToolCalls(HISTORY_DAYS);

  // The next view reads the round just written, rather than the minute-old copy.
  revalidateTag(STATUS_TAG, { expire: 0 });

  return Response.json({
    recorded: rows.length,
    pruned,
    unavailable: round.unavailable,
    sources: rows.map((row) => ({ source: row.source, ok: row.ok, code: row.code, ms: row.durationMs })),
  });
}
