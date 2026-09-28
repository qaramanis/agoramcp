import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { columnGapClass, Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Code } from "@/components/mcp/inline";
import HistoryStrip from "@/components/status/history-strip";
import {
  DEGRADED_SHARE,
  formatChecked,
  HEALTH_LABELS,
  HISTORY_DAYS,
  loadStatus,
  OUTAGE_SHARE,
  SLOW_MS,
  summarise,
  TIMEOUT_MS,
  type Health,
  type SourceHistory,
  type SourceStatus,
} from "@/data/status";

export const metadata: Metadata = {
  title: "Status - agoramcp",
  description:
    "A live check per registry through the public API, and the last 90 days of every call that went through agoramcp, counted by the day.",
};

/**
 * Never prerendered and never revalidated. Every other page can afford a
 * minute of staleness; this one cannot afford any — a status page that reads a
 * cached check is reporting the past while dating it now.
 */
export const revalidate = 0;

export default async function StatusPage() {
  const { sources, checkedAt, unavailable, history, historyUnavailable } = await loadStatus();

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Is it answering?
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Opening this page calls one tool on every registry agoramcp
              mounts, through the same public API anyone else uses, and reports
              what came back. That verdict happened while the page was being
              built for you. The bars under each registry are the last{" "}
              {HISTORY_DAYS} days: every call that went through the server
              &mdash; yours, the console&apos;s, the monitor&apos;s &mdash;
              counted by the day.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              A registry that is not answering is almost always the
              registry&apos;s own outage rather than ours &mdash; but either way
              it is a question you cannot get an answer to right now, which is
              what this page is for.
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            {unavailable ? (
              <Unreachable message={unavailable} />
            ) : (
              <Verdict sources={sources} checkedAt={checkedAt} />
            )}
          </div>
        </Grid>
      </header>

      {sources.length > 0 && (
        <Band ariaLabel="Registries" title={`Every registry, now and over ${HISTORY_DAYS} days.`}>
          <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
            The tool each check called is named beside the source, so you can
            run the same call yourself and compare. Times are the whole round
            trip from this server &mdash; our own hop included, not just the
            registry&apos;s. Each bar is one day; hover it for how many calls
            the registry was asked and how many it did not answer.
          </p>

          {historyUnavailable && (
            <p className="col-span-8 col-start-1 mt-3 text-[12px] leading-relaxed text-warn md:col-span-6">
              {historyUnavailable} The checks above still stand.
            </p>
          )}

          <ul className="col-span-8 col-start-1 mt-8 flex flex-col">
            {sources.map((source) => (
              <li
                key={`${source.country}/${source.id}`}
                className="border-t border-panel-border/50 py-5 first:border-t-0 first:pt-0"
              >
                <Row source={source} history={history[`${source.country}/${source.id}`]} />
              </li>
            ))}
          </ul>
        </Band>
      )}

      <Method />
    </main>
  );
}

/** The one-line answer, and the minute it was true. */
function Verdict({
  sources,
  checkedAt,
}: {
  sources: SourceStatus[];
  checkedAt: Date;
}) {
  const failing = sources.some((source) => source.health !== "ok");

  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        Right now
      </p>

      <div className="mt-3 flex items-baseline gap-2 border-t border-panel-border/70 pt-3">
        <Dot health={failing ? "down" : "ok"} />
        <p className="text-[13px] text-foreground">{summarise(sources)}</p>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Checked at {formatChecked(checkedAt)}. Reload to check again.
      </p>
    </div>
  );
}

/**
 * One registry: what was asked, what came back, how long it took — and, under
 * that, the strip of its last ninety days.
 */
function Row({
  source,
  history,
}: {
  source: SourceStatus;
  history: SourceHistory | undefined;
}) {
  return (
    <div className={`grid grid-cols-8 gap-y-3 ${columnGapClass}`}>
      <div className="col-span-8 col-start-1 md:col-span-3">
        <Link
          href={source.href}
          className="group flex w-fit items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
        >
          {source.name}
          <ArrowUpRight size={12} className="shrink-0" />
        </Link>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          <Code>{source.tool}</Code>
        </p>
      </div>

      <div className="col-span-8 col-start-1 md:col-span-3 md:col-start-4">
        <div className="flex items-baseline gap-2">
          <Dot health={source.health} />
          <p className="text-[13px] text-foreground">
            {HEALTH_LABELS[source.health]}
          </p>
        </div>
        {source.detail && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-warn">
            {source.detail}
          </p>
        )}
      </div>

      <p className="col-span-8 col-start-1 text-[12px] text-muted tabular-nums md:col-span-2 md:col-start-7 md:text-right">
        {source.ms} ms
      </p>

      {history && (
        <div className="col-span-8 col-start-1 mt-2">
          <HistoryStrip history={history} />
        </div>
      )}
    </div>
  );
}

/**
 * Green for an answer, the site's one warning colour for anything else. The
 * label beside it carries the difference between slow and silent — the palette
 * is two colours on purpose, and a third invented here would read as a state
 * the rest of the site does not have.
 */
function Dot({ health }: { health: Health }) {
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${
        health === "ok" ? "bg-accent" : "bg-warn"
      }`}
    />
  );
}

function Method() {
  const degradedPast = Math.round(1 / DEGRADED_SHARE);
  const outagePast = Math.round(1 / OUTAGE_SHARE);

  return (
    <Band ariaLabel="Method" title="What this check actually does.">
      <ul className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
        <li>
          <p className="text-[13px] text-foreground">
            It goes through the front door
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Each check is a plain HTTP request to{" "}
            <Code>/{"{country}"}/api/{"{source}"}/{"{tool}"}</Code>, with the
            arguments that tool already ships as its example. It measures the
            whole path a caller uses &mdash; this server, the source&apos;s
            adapter, the registry behind it &mdash; rather than pinging a
            registry directly and reporting on something nobody calls.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">
            It asks a question, not for a record
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Where a source has a search, that is what the check calls. A search
            exercises the registry&apos;s own index, and it is where each source
            sets its shortest cache lifetime &mdash; so a green light is about
            the last few minutes rather than about whenever some record was
            first fetched. A source with nothing to search gets its cheapest
            list instead, never a lookup: a check should not be sending someone
            else&apos;s identifier upstream on every page view.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">
            An answer may be a cached answer
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Tool results are cached for as long as each source says, so a check
            can be answered without the registry being touched. That is not a
            false positive: it is what a caller would get right now, which is
            the question this page asks. A time in the single milliseconds is
            the cache; a few hundred is a real round trip.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">Slow and silent</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Over {SLOW_MS / 1_000} seconds is reported as answering slowly;
            after {TIMEOUT_MS / 1_000} the check is abandoned and reported as no
            answer. A failure that comes back as an error is quoted in the
            API&apos;s own words &mdash;{" "}
            <Link
              href="/api"
              className="text-foreground transition-colors duration-300 hover:text-accent"
            >
              every code it can send
            </Link>{" "}
            is listed with what it means. A registry can also fail without an
            error, by answering with nothing. The earthquake catalogue is asked
            for its last 24 hours, and has recorded at least ten earthquakes in
            every 24 hours since 2018, so an answer with none in it is reported
            as not answering.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">Every call counts</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Each call that goes through the server &mdash; from an MCP client,
            from the API, or from the monitor &mdash; leaves one row: which
            registry, which tool, whether it answered, the error&apos;s code
            when it did not, and how long it took. Never the arguments, and
            never who asked. A day is marked as degraded once more than one
            call in {degradedPast} went unanswered, as an outage past one in{" "}
            {outagePast}, and left blank when nothing was asked. A{" "}
            <Code>not_found</Code> or <Code>invalid_input</Code> is the
            caller&apos;s own, and counts as answered. Rows are kept for{" "}
            {HISTORY_DAYS} days.
          </p>
        </li>
      </ul>

      <p className="col-span-8 col-start-1 mt-8 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
        The verdict at the top is one call each &mdash; a sample. The bars are
        the monitor: the same check runs every ten minutes, and every real call
        is counted beside it, so a bar is never one unlucky moment. To see for
        yourself, put the same question to a tool in the{" "}
        <Link
          href="/live"
          className="text-foreground transition-colors duration-300 hover:text-accent"
        >
          live console
        </Link>
        .
      </p>
    </Band>
  );
}

/** Our own server did not answer, so there is nothing to report about theirs. */
function Unreachable({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        Right now
      </p>
      <div className="mt-3 flex items-baseline gap-2 border-t border-panel-border/70 pt-3">
        <Dot health="down" />
        <p className="text-[13px] text-foreground">agoramcp is not answering.</p>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-warn">
        {message} Until it does, nothing can be said about the registries behind
        it &mdash; they may well be fine.
      </p>
    </div>
  );
}
