import { revalidateTag } from "next/cache";
import { HISTORY_DAYS, runRound, STATUS_TAG } from "@/data/status";
import { claimRound, pruneToolCalls } from "@/db/tool-calls";

/**
 * The status monitor's daily round. Vercel calls this once a day
 * (`vercel.json`; its free plan allows no more, and starts the run some time
 * within the hour). It asks each registry its source's declared probe
 * through the public API, with the web app's proof so the server skips its
 * cache, and writes what came back as `probe` rows beside the real calls the
 * server records — so a registry nobody called, and a page nobody opened,
 * still has something to say, and a stretch when our own server was down is
 * recorded as one, which the server cannot do for itself. Then it lets go
 * of rows older than the page shows, and clears the page's cached read, so
 * the round is on the page by the next view. Between these daily rounds,
 * the page starts its own when it is opened (`data/status.ts`).
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

  // Always runs, and moves the claim forward so a reader who opens the page
  // during the round does not start a second one.
  await claimRound(0);
  const { rows, unavailable } = await runRound();
  const pruned = await pruneToolCalls(HISTORY_DAYS);

  // The next view reads the round just written, rather than the minute-old copy.
  revalidateTag(STATUS_TAG, { expire: 0 });

  return Response.json({
    recorded: rows.length,
    pruned,
    unavailable,
    sources: rows.map((row) => ({ source: row.source, ok: row.ok, code: row.code, ms: row.durationMs })),
  });
}
