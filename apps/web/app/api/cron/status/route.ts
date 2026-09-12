import { HISTORY_DAYS, probeAll } from "@/data/status";
import { knownSources, pruneToolCalls, recordProbes, type ProbeRow } from "@/db/tool-calls";

/**
 * The status monitor. Vercel calls this every ten minutes (`vercel.json`);
 * it makes one call per registry exactly as the status page does and writes
 * what came back as `probe` rows beside the real calls the server records —
 * so a quiet day still has something to say, and a stretch when our own
 * server was down is recorded as one, which the server cannot do for
 * itself. Then it lets go of rows older than the page shows.
 *
 * Only the cron may call it: Vercel sends the project's `CRON_SECRET` as a
 * bearer token, and nothing else knows it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const live = await probeAll();

  // Our server could not even be asked what it mounts, so every registry
  // seen lately is unreachable through us — which is what a caller would find.
  const rows: ProbeRow[] = live.unavailable
    ? (await knownSources(HISTORY_DAYS)).map((source) => ({
        source,
        tool: "",
        ok: false,
        code: "unreachable",
        durationMs: 0,
      }))
    : live.sources.map((source) => ({
        source: `${source.country}/${source.id}`,
        tool: source.tool,
        ok: source.health !== "down",
        code: source.code,
        durationMs: source.ms,
      }));

  await recordProbes(rows);
  const pruned = await pruneToolCalls(HISTORY_DAYS);

  return Response.json({
    recorded: rows.length,
    pruned,
    unavailable: live.unavailable,
    sources: rows.map((row) => ({ source: row.source, ok: row.ok, code: row.code, ms: row.durationMs })),
  });
}
