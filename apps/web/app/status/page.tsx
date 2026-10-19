import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight } from "lucide-react";
import { columnGapClass, Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Code } from "@/components/mcp/inline";
import HistoryStrip from "@/components/status/history-strip";
import {
  ASK_AGAIN_MINUTES,
  CHECK_WINDOW,
  claimViewRound,
  DEGRADED_SHARE,
  EVIDENCE_DAYS,
  formatChecked,
  formatTime,
  HEALTH_LABELS,
  HISTORY_DAYS,
  loadStatus,
  makeViewRound,
  OUTAGE_SHARE,
  SLOW_MS,
  STALE_AFTER_HOURS,
  TIMEOUT_MS,
  type AskedBy,
  type Health,
  type SourceHistory,
  type SourceStatus,
  type Status,
  type Verdict,
} from "@/data/status";

export const metadata: Metadata = {
  title: "Status - agoramcp",
  description:
    "Every registry agoramcp mounts, as its newest call found it, checked through the public API once a day and whenever this page is opened ten minutes after the last check, and the last 90 days of every call that reached a registry, counted by the day.",
};

/**
 * Rendered per request, like every page that reads the server: what it shows
 * is the record of calls, read through a cache that holds it for a minute
 * and that each round clears (`data/status.ts`). When the monitor's newest
 * check is older than `ASK_AGAIN_MINUTES`, the one view that claims the next
 * round makes it: that reader gets the record at once and the round's
 * answers streamed in over it, and every other reader is not held up.
 */
export const revalidate = 0;

export default async function StatusPage() {
  const now = new Date();
  const status = await loadStatus(now);
  const asking = await claimViewRound(status);

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {asking ? (
        <Suspense fallback={<Current status={status} now={now} asking />}>
          <AskedAgain />
        </Suspense>
      ) : (
        <Current status={status} now={now} asking={false} />
      )}

      <Method />
    </main>
  );
}

/** The round this view claimed, made while the page streams, and the record read again past the cache. */
async function AskedAgain() {
  await makeViewRound();
  const now = new Date();
  return <Current status={await loadStatus(now, { fresh: true })} now={now} asking={false} />;
}

/** The answer at the top, and every registry under it. */
function Current({ status, now, asking }: { status: Status; now: Date; asking: boolean }) {
  const { verdict, sources, history, monitorUnavailable, catalogueUnavailable } = status;

  return (
    <>
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Is it answering?
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Every call that goes through agoramcp is recorded, and a monitor
              asks each registry one question of its own, through the same
              public API anyone else uses, skipping our cache so the answer
              comes from the registry itself. It asks once a day, and again
              whenever this page is opened and its last check is more than{" "}
              {ASK_AGAIN_MINUTES} minutes old. Each registry is shown as the
              newest of these found it, whoever asked. The bars under each
              registry are the last {HISTORY_DAYS} days: every call that reached
              the registry &mdash; yours, the console&apos;s, the
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
            <VerdictPanel verdict={verdict} unavailable={monitorUnavailable} now={now} asking={asking} />
          </div>
        </Grid>
      </header>

      {sources.length > 0 && (
        <Band ariaLabel="Registries" title={`Every registry, now and over ${HISTORY_DAYS} days.`}>
          <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
            The tool the monitor&apos;s check calls is named beside the
            source, so you can run the same call yourself and compare. Its
            time, on the right, is the whole round trip the monitor measured
            &mdash; our own hop included, not just the registry&apos;s. Each
            bar is one day; hover it for how many calls the registry was asked
            and how many it did not answer.
          </p>

          {catalogueUnavailable && (
            <p className="col-span-8 col-start-1 mt-3 text-[12px] leading-relaxed text-warn md:col-span-6">
              {catalogueUnavailable} The registries are listed by the keys the
              record holds them under.
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
    </>
  );
}

/** The one-line answer, and when it was last true. */
function VerdictPanel({
  verdict,
  unavailable,
  now,
  asking,
}: {
  verdict: Verdict;
  unavailable: string | null;
  now: Date;
  asking: boolean;
}) {
  const health: Health =
    verdict.state === "ok" ? "ok" : verdict.state === "stale" || verdict.state === "none" ? "unknown" : "down";
  const current = verdict.state === "ok" || verdict.state === "degraded" || verdict.state === "down";

  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">When last asked</p>

      <div className="mt-3 flex items-baseline gap-2 border-t border-panel-border/70 pt-3">
        <Dot health={health} />
        <p className="text-[13px] text-foreground">{verdict.summary}</p>
      </div>

      {unavailable && <p className="mt-2 text-[12px] leading-relaxed text-warn">{unavailable}</p>}

      {asking && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          The monitor is asking every registry again now. Its answers replace
          these in a few seconds.
        </p>
      )}

      {verdict.state === "server" && (
        <p className="mt-2 text-[12px] leading-relaxed text-warn">
          Our own server did not answer the monitor&apos;s latest check, and no
          call has gone through it since. Until one does, nothing can be said
          about the registries behind it &mdash; they may well be fine.
        </p>
      )}

      {verdict.state === "stale" && (
        <p className="mt-2 text-[12px] leading-relaxed text-warn">
          Not even the monitor has checked since, so the states below are
          what was last seen, not what is true now.
        </p>
      )}

      {current && verdict.monitorLate && (
        <p className="mt-2 text-[12px] leading-relaxed text-warn">
          {verdict.checkedAt
            ? `The monitor has not checked since ${formatChecked(verdict.checkedAt)}.`
            : `The monitor has not checked in the last ${EVIDENCE_DAYS} days.`}{" "}
          A registry nobody has called since is shown as not asked recently.
        </p>
      )}

      {verdict.state === "none" && !unavailable && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Every call through agoramcp is recorded here, and the monitor asks
          every registry once a day, {CHECK_WINDOW}; the first will appear here.
        </p>
      )}

      {verdict.askedAt && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Last asked at {formatChecked(verdict.askedAt)}.
          {verdict.checkedAt && !verdict.monitorLate && (
            <>
              {" "}The monitor last checked at {when(verdict.checkedAt, now)}. It
              checks once a day, {CHECK_WINDOW}, and again when this page is
              opened more than {ASK_AGAIN_MINUTES} minutes after its last check.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** "14:20 UTC", or the full date when it was on an earlier day. */
function when(iso: string, now: Date): string {
  return iso.slice(0, 10) === now.toISOString().slice(0, 10) ? formatTime(iso) : formatChecked(iso);
}

const ASKED_BY: Record<AskedBy, string> = {
  check: "by the monitor's check",
  api: "by a call through the API",
  mcp: "by a call over MCP",
};

/** Who asked last, and when: the evidence the state rests on. */
function askedLine(source: SourceStatus, now: Date): string | null {
  if (source.health === "unknown" || !source.askedAt || !source.askedBy) return null;
  return `Last asked at ${when(source.askedAt, now)}, ${ASKED_BY[source.askedBy]}.`;
}

/** How long the present state has held, in calls and checks. */
function runLine(source: SourceStatus, now: Date): string | null {
  if (source.health === "unknown" || !source.since) return null;
  const answering = source.health !== "down";
  if (source.sinceOrEarlier) {
    return answering
      ? `Every call and check of the last ${EVIDENCE_DAYS} days answered.`
      : `No call or check of the last ${EVIDENCE_DAYS} days answered.`;
  }
  const count = answering
    ? `${source.run} ${source.run === 1 ? "answer" : "answers in a row"}`
    : `${source.run} ${source.run === 1 ? "failure" : "failures in a row"}`;
  return `${answering ? "Answering" : "Not answering"} since ${when(source.since, now)}, ${count}.`;
}

/** The last day, counted: a failure beside a newer answer still shows here. */
function dayLine(source: SourceStatus): string | null {
  const { total, failed } = source.lastDay;
  if (total === 0) return null;
  const asked = `${total} ${total === 1 ? "call or check" : "calls and checks"}`;
  return failed === 0
    ? `Last 24 hours: ${asked}, ${total === 1 ? "answered" : "all answered"}.`
    : `Last 24 hours: ${failed} of ${asked} not answered.`;
}

/**
 * One registry: what its newest call or check found, who asked and since
 * when, the monitor's own check — and, under that, the strip of its last
 * ninety days.
 */
function Row({ source, history, now }: { source: SourceStatus; history: SourceHistory | undefined; now: Date }) {
  const asked = askedLine(source, now);
  const run = runLine(source, now);
  const day = dayLine(source);

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
        {source.check && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            <Code>{source.check.tool}</Code>
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
        {asked && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{asked}</p>}
        {run && <p className="mt-1 text-[11px] leading-relaxed text-muted">{run}</p>}
        {day && (
          <p className={`mt-1 text-[11px] leading-relaxed ${source.lastDay.failed > 0 ? "text-warn" : "text-muted"}`}>
            {day}
          </p>
        )}
      </div>

      <div className="col-span-8 col-start-1 md:col-span-2 md:col-start-7 md:text-right">
        {source.check && (
          <>
            <p className="text-[12px] text-muted tabular-nums">{source.check.ms} ms</p>
            <p className="mt-0.5 text-[11px] text-muted tabular-nums">
              {source.check.ok ? "checked" : "check failed"} at {when(source.check.at, now)}
            </p>
          </>
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
            the server answers it without reading its cache, so its answer
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
            A check over {SLOW_MS / 1_000} seconds is reported as answering
            slowly; after {TIMEOUT_MS / 1_000} it is abandoned and reported as
            no answer. Only the check is held to time: a real call takes as long
            as the question it asked. A failure is named by the API&apos;s own
            code &mdash;{" "}
            <Link href="/api" className="text-foreground transition-colors duration-300 hover:text-accent">
              every code it can send
            </Link>{" "}
            is listed with what it means. If nothing has asked a registry for{" "}
            {STALE_AFTER_HOURS} hours, what it last did is shown as that, not
            as the present.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">Every call counts</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Each call that goes through the server &mdash; from an MCP client,
            from the API, or from the monitor &mdash; leaves one row: which
            registry, which tool, whether it answered, the error&apos;s code
            when it did not, and how long it took. Never the arguments, and
            never who asked. A call the server answered from its own cache
            never reached the registry, so this page leaves it out. The newest
            row, a call or the check, is the state shown for each registry, so
            a call that failed a minute ago is on this page within a minute,
            without waiting for the next check. A day is marked as degraded
            once more than one call
            in {degradedPast} went unanswered, as an outage past one in{" "}
            {outagePast}, and left blank when nothing was asked. A{" "}
            <Code>not_found</Code> or <Code>invalid_input</Code> is the
            caller&apos;s own, and counts as answered. Rows are kept for{" "}
            {HISTORY_DAYS} days.
          </p>
        </li>
      </ul>

      <p className="col-span-8 col-start-1 mt-8 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
        Opening this page reads the record of calls, which the site reads
        again at most once a minute. When the monitor&apos;s last check is
        more than {ASK_AGAIN_MINUTES} minutes old, it also starts the next
        one, one at a time however many people open it, and shows the answers
        as they come in. To ask a registry a question yourself, right now, use
        a tool in the{" "}
        <Link href="/live" className="text-foreground transition-colors duration-300 hover:text-accent">
          live console
        </Link>
        .
      </p>
    </Band>
  );
}
