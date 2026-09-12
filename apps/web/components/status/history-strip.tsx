import { formatDay } from "@/data/format";
import { HISTORY_DAYS, type DayHealth, type DayState, type SourceHistory } from "@/data/status";

/**
 * One registry's last ninety days as a strip of cells, oldest on the left,
 * today on the right, with the window's share of answered calls under it.
 *
 * The cells keep to the site's two colours: green for a day that answered,
 * the one warning colour for a day that did not — at half strength while it
 * was only some calls, full when it was many — and the panel's own border
 * grey for a day nothing was asked, which is an absence rather than a state.
 * Each cell's title carries the count, so the figure is a hover away.
 */
export default function HistoryStrip({ history }: { history: SourceHistory }) {
  return (
    <div>
      <ol className="flex gap-px" aria-label={`The last ${HISTORY_DAYS} days`}>
        {history.days.map((day) => (
          <li
            key={day.date}
            title={describe(day)}
            className={`h-6 min-w-0 flex-1 rounded-[1px] ${CELL[day.state]}`}
          />
        ))}
      </ol>

      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted tabular-nums">
        <span className="shrink-0">{HISTORY_DAYS} days ago</span>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-panel-border/50" />
        <span className="shrink-0 text-muted-foreground">{answered(history.uptime)}</span>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-panel-border/50" />
        <span className="shrink-0">Today</span>
      </div>
    </div>
  );
}

const CELL: Record<DayState, string> = {
  ok: "bg-accent",
  degraded: "bg-warn/60",
  outage: "bg-warn",
  none: "bg-panel-border",
};

/** "7 September 2026 — 1,203 calls, 3 not answered" */
function describe(day: DayHealth): string {
  const when = formatDay(day.date);
  if (day.total === 0) return `${when} — no calls`;
  const calls = `${day.total.toLocaleString("en-GB")} ${day.total === 1 ? "call" : "calls"}`;
  const missed = day.failed === 0 ? "all answered" : `${day.failed.toLocaleString("en-GB")} not answered`;
  return `${when} — ${calls}, ${missed}`;
}

/** "99.4% answered" — two decimals at most, none when they are zeros. */
function answered(uptime: number | null): string {
  if (uptime === null) return "no calls yet";
  const percent = Number((uptime * 100).toFixed(2));
  return `${percent}% answered`;
}
