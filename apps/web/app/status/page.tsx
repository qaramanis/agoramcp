import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { columnGapClass, Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Code } from "@/components/mcp/inline";
import HistoryStrip from "@/components/status/history-strip";
import {
  CHECK_EVERY_MINUTES,
  DEGRADED_SHARE,
  formatChecked,
  formatTime,
  HEALTH_LABELS,
  HISTORY_DAYS,
  loadStatus,
  OUTAGE_SHARE,
  SLOW_MS,
  STALE_AFTER_MINUTES,
  TIMEOUT_MS,
  type Health,
  type SourceHistory,
  type SourceStatus,
  type Verdict,
} from "@/data/status";

export const metadata: Metadata = {
  title: "Status - agoramcp",
  description:
    "Every registry agoramcp mounts, checked every ten minutes through the public API, and the last 90 days of every call that went through agoramcp, counted by the day.",
};

/**
 * Rendered per request, like every page that reads the server, but it calls
 * nothing: what it shows is the monitor's record, read through a cache the
 * monitor clears after each round (`data/status.ts`).
 */
export const revalidate = 0;

export default async function StatusPage() {
  const now = new Date();
  const { verdict, sources, history, monitorUnavailable, catalogueUnavailable } = await loadStatus(now);

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Is it answering?
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Every {CHECK_EVERY_MINUTES} minutes a monitor asks each registry
              agoramcp mounts one question, through the same public API anyone
              else uses, and skips our cache so the answer comes from the
              registry itself. This page reports its latest check, and what
              everyone else&apos;s calls have said since. The bars under each
              registry are the last {HISTORY_DAYS} days: every call that went
              through the server &mdash; yours, the console&apos;s, the
              monitor&apos;s &mdash; counted by the day.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              A registry that is not answering is almost always the
              registry&apos;s own outage rather than ours &mdash; but either way
              it is a question you cannot get an answer to right now, which is
              what this page is for.
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            <VerdictPanel verdict={verdict} unavailable={monitorUnavailable} />
          </div>
        </Grid>
      </header>

      {sources.length > 0 && (
        <Band ariaLabel="Registries" title={`Every registry, now and over ${HISTORY_DAYS} days.`}>
          <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
            The tool each check called is named beside the source, so you can
            run the same call yourself and compare. Times are the whole round
            trip the monitor measured &mdash; our own hop included, not just
            the registry&apos;s. Each bar is one day; hover it for how many
            calls the registry was asked and how many it did not answer.
          </p>

          {catalogueUnavailable && (
            <p className="col-span-8 col-start-1 mt-3 text-[12px] leading-relaxed text-warn md:col-span-6">
              {catalogueUnavailable} The registries are listed by the keys the
              monitor recorded them under.
            </p>
          )}

          <ul className="col-span-8 col-start-1 mt-8 flex flex-col">
            {sources.map((source) => (
              <li key={source.key} className="border-t border-panel-border/50 py-5 first:border-t-0 first:pt-0">
                <Row source={source} history={history[source.key]} now={now} />
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
function VerdictPanel({ verdict, unavailable }: { verdict: Verdict; unavailable: string | null }) {
  const health: Health =
    verdict.state === "ok" ? "ok" : verdict.state === "stale" || verdict.state === "none" ? "unknown" : "down";

  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">Latest check</p>

      <div className="mt-3 flex items-baseline gap-2 border-t border-panel-border/70 pt-3">
        <Dot health={health} />
        <p className="text-[13px] text-foreground">{verdict.summary}</p>
      </div>

      {unavailable && <p className="mt-2 text-[12px] leading-relaxed text-warn">{unavailable}</p>}

      {verdict.state === "server" && (
        <p className="mt-2 text-[12px] leading-relaxed text-warn">
          Our own server did not answer the monitor&apos;s latest check. Until
          it does, nothing can be said about the registries behind it &mdash;
          they may well be fine.
        </p>
      )}

      {verdict.state === "stale" && (
        <p className="mt-2 text-[12px] leading-relaxed text-warn">
          It checks every {CHECK_EVERY_MINUTES} minutes, so the states below
          are what it saw then, not what is true now.
        </p>
      )}

      {verdict.state === "none" && !unavailable && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          The monitor checks every registry once every {CHECK_EVERY_MINUTES} minutes;
          its first round will appear here.
        </p>
      )}

      {verdict.checkedAt && verdict.nextCheckBy && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Checked at {formatChecked(verdict.checkedAt)}. The next check is due
          by {formatTime(verdict.nextCheckBy)}.
        </p>
      )}
    </div>
  );
}

/** "since 14:20 UTC", or the full date when the run began on an earlier day. */
function when(iso: string, now: Date): string {
  return iso.slice(0, 10) === now.toISOString().slice(0, 10) ? formatTime(iso) : formatChecked(iso);
}

/** How long the present state has held, in the monitor's own checks. */
function runLine(source: SourceStatus, now: Date): string | null {
  if (source.health === "unknown" || !source.since) return null;
  const answering = source.health !== "down";
  if (source.sinceOrEarlier) {
    return answering ? "Every check of the last 24 hours answered." : "No check of the last 24 hours answered.";
  }
  const checks = `${source.checks} ${source.checks === 1 ? "check" : "checks in a row"}`;
  return `${answering ? "Answering" : "Not answering"} since ${when(source.since, now)}, ${checks}.`;
}

/** What real calls have said since the check: free evidence between rounds. */
function trafficLine(source: SourceStatus): string | null {
  const traffic = source.traffic;
  if (!traffic || traffic.total === 0) return null;
  const calls = `${traffic.total} ${traffic.total === 1 ? "call" : "calls"}`;
  if (traffic.failed === 0) {
    return `Since this check, ${calls} through agoramcp, ${traffic.total === 1 ? "answered" : "all answered"}${
      traffic.lastAnsweredAt ? `, the last at ${formatTime(traffic.lastAnsweredAt)}` : ""
    }.`;
  }
  return `Since this check, ${traffic.failed} of ${calls} through agoramcp not answered${
    traffic.lastFailedAt ? `, the last at ${formatTime(traffic.lastFailedAt)}` : ""
  }.`;
}

/**
 * One registry: what was asked, what came back, how long it took and since
 * when — and, under that, the strip of its last ninety days.
 */
function Row({ source, history, now }: { source: SourceStatus; history: SourceHistory | undefined; now: Date }) {
  const run = runLine(source, now);
  const traffic = trafficLine(source);

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
        {source.tool && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            <Code>{source.tool}</Code>
          </p>
        )}
      </div>

      <div className="col-span-8 col-start-1 md:col-span-3 md:col-start-4">
        <div className="flex items-baseline gap-2">
          <Dot health={source.health} />
          <p className="text-[13px] text-foreground">{HEALTH_LABELS[source.health]}</p>
        </div>
        {source.detail && (
          <p
            className={`mt-1.5 text-[12px] leading-relaxed ${source.health === "down" ? "text-warn" : "text-muted-foreground"}`}
          >
            {source.detail}
          </p>
        )}
        {run && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{run}</p>}
        {traffic && (
          <p
            className={`mt-1 text-[11px] leading-relaxed ${source.traffic && source.traffic.failed > 0 ? "text-warn" : "text-muted"}`}
          >
            {traffic}
          </p>
        )}
      </div>

      <div className="col-span-8 col-start-1 md:col-span-2 md:col-start-7 md:text-right">
        {source.ms !== null && <p className="text-[12px] text-muted tabular-nums">{source.ms} ms</p>}
        {source.checkedAt && (
          <p className="mt-0.5 text-[11px] text-muted tabular-nums">at {when(source.checkedAt, now)}</p>
        )}
      </div>

      {history && (
        <div className="col-span-8 col-start-1 mt-2">
          <HistoryStrip history={history} />
        </div>
      )}
    </div>
  );
}

/**
 * Green for an answer, the site's one warning colour for anything else, and
 * an empty ring where there is nothing recent to go on. The label beside it
 * carries the difference between slow and silent — the palette is two
 * colours on purpose, and the ring is an absence rather than a third state.
 */
function Dot({ health }: { health: Health }) {
  const fill =
    health === "ok"
      ? "bg-accent"
      : health === "unknown"
        ? "border border-muted bg-transparent"
        : "bg-warn";
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${fill}`} />;
}

function Method() {
  const degradedPast = Math.round(1 / DEGRADED_SHARE);
  const outagePast = Math.round(1 / OUTAGE_SHARE);

  return (
    <Band ariaLabel="Method" title="What this check actually does.">
      <ul className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
        <li>
          <p className="text-[13px] text-foreground">It goes through the front door</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Each check is a plain HTTP request to{" "}
            <Code>/{"{country}"}/api/{"{source}"}/{"{tool}"}</Code>, the address
            anyone else would call. It measures the whole path a caller uses
            &mdash; this server, the source&apos;s adapter, the registry behind
            it &mdash; rather than pinging a registry directly and reporting on
            something nobody calls.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">It reaches the registry every time</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Answers are cached for as long as each source says, so an ordinary
            call can be answered without the registry being touched. The
            monitor&apos;s call carries a mark that only this site can make, and
            the server answers it without reading its cache, so a green light
            means the registry itself answered at that minute. What it fetched
            is still cached for the next caller.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">It asks a question that cannot come back empty</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Each source chooses its own check: its cheapest live question
            &mdash; a search or a list, never a lookup of someone&apos;s record
            &mdash; and one a working registry cannot answer with nothing. A
            registry can fail without an error, by answering with nothing: the
            earthquake catalogue did, for days, in September 2026. An answer
            short of what the source expects, such as no earthquakes in the
            last 24 hours, is reported as not answering.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">Slow, silent and stale</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Over {SLOW_MS / 1_000} seconds is reported as answering slowly;
            after {TIMEOUT_MS / 1_000} the check is abandoned and reported as no
            answer. A failure that comes back as an error is quoted in the
            API&apos;s own words &mdash;{" "}
            <Link href="/api" className="text-foreground transition-colors duration-300 hover:text-accent">
              every code it can send
            </Link>{" "}
            is listed with what it means. If the monitor has not checked a
            registry for {STALE_AFTER_MINUTES} minutes, what it last saw is
            shown as that, not as the present.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">Every call counts</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Each call that goes through the server &mdash; from an MCP client,
            from the API, or from the monitor &mdash; leaves one row: which
            registry, which tool, whether it answered, the error&apos;s code
            when it did not, and how long it took. Never the arguments, and
            never who asked. The calls made since the latest check are counted
            under each registry, so a failure between checks shows here before
            the next one. A day is marked as degraded once more than one call
            in {degradedPast} went unanswered, as an outage past one in{" "}
            {outagePast}, and left blank when nothing was asked. A{" "}
            <Code>not_found</Code> or <Code>invalid_input</Code> is the
            caller&apos;s own, and counts as answered. Rows are kept for{" "}
            {HISTORY_DAYS} days.
          </p>
        </li>
      </ul>

      <p className="col-span-8 col-start-1 mt-8 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
        Opening this page calls nothing: it reads the monitor&apos;s record,
        and shows each round within seconds of it being made. To ask a registry
        a question yourself, right now, use a tool in the{" "}
        <Link href="/live" className="text-foreground transition-colors duration-300 hover:text-accent">
          live console
        </Link>
        .
      </p>
    </Band>
  );
}
