import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { columnGapClass, Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import {
  changesByDate,
  formatDay,
  KIND_LABELS,
  latestChange,
  type Change,
} from "@/data/changelog";

export const metadata: Metadata = {
  title: "Changelog — agoramcp",
  description:
    "Every registry, server and page as it landed, newest first, with the day it arrived.",
};

export default function ChangelogPage() {
  const days = changesByDate();
  const latest = latestChange();

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              What changed, and when.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              A registry arriving, a server growing an interface, a page
              landing. Dated, newest first, and written for someone who has to
              decide whether anything they built on still holds.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Nothing has been removed or renamed yet. When something is, it
              will say so here first.
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            {latest && <Latest change={latest} />}
          </div>
        </Grid>
      </header>

      <Band ariaLabel="Changelog" title="Every change, newest first.">
        <div className="col-span-8 col-start-1 mt-4 flex flex-col gap-12">
          {days.map(([date, entries]) => (
            <section
              key={date}
              aria-label={formatDay(date)}
              className={`grid grid-cols-8 gap-y-6 ${columnGapClass}`}
            >
              {/* The date is the row's label, beside its entries from md up
                  and above them on a phone — two columns of the section's
                  eight, so it lands on the page's own grid. */}
              <p className="col-span-8 col-start-1 text-[11px] text-muted md:col-span-2">
                {formatDay(date)}
              </p>

              <ul className="col-span-8 col-start-1 flex flex-col gap-8 md:col-span-6 md:col-start-3">
                {entries.map((change) => (
                  <li key={`${change.date}-${change.title}`}>
                    <Entry change={change} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Band>
    </main>
  );
}

/** The newest entry, in the hero, so the page opens on the answer to "anything new?". */
function Latest({ change }: { change: Change }) {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        Latest
      </p>
      <div className="mt-3 border-t border-panel-border/70 pt-3">
        <p className="text-[11px] text-muted">{formatDay(change.date)}</p>
        <div className="mt-2">
          <Entry change={change} />
        </div>
      </div>
    </div>
  );
}

/** One entry: what it is, what it was, and where to go and read it. */
function Entry({ change }: { change: Change }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[13px] text-foreground">{change.title}</p>
        <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
          {KIND_LABELS[change.kind]}
        </p>
      </div>

      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
        {change.body}
      </p>

      {change.href && (
        <Link
          href={change.href}
          className="group mt-2 flex w-fit items-center gap-1 text-[12px] text-foreground transition-colors duration-300 hover:text-accent"
        >
          Read it
          <ArrowUpRight size={12} className="shrink-0" />
        </Link>
      )}
    </>
  );
}
