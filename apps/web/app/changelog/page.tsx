import type { Metadata } from "next";
import { Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Ticks } from "@/components/mcp/inline";
import { changelog, type ChangelogEntry } from "@/data/changelog";
import { formatDay } from "@/data/format";
import { currentRelease } from "@/data/version";

export const metadata: Metadata = {
  title: "Changelog - agoramcp",
  description:
    "What changed in agoramcp, newest first, each entry with the version the project was at when it landed.",
};

export default function ChangelogPage() {
  // The same call the footer makes, so the panel and the corner agree.
  const latest = currentRelease();

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              What changed, and when.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Written by hand, one entry per change worth a line, and
              committed together with the work it describes. What each entry
              says is what was written when the change was made, not a
              summary made later.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              The version in front of each one is the version the project stood
              at when that commit landed: the same counter the footer carries,
              whose last part is the number of commits behind it.
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            {latest && <Latest entry={latest} />}
          </div>
        </Grid>
      </header>

      <Band ariaLabel="Changelog" title="From newest to first.">
        <ul className="col-span-8 col-start-1 mt-8 flex flex-col">
          {changelog.map((entry) => (
            <li
              key={entry.version}
              className="border-t border-panel-border/50 py-6 first:border-t-0 first:pt-0"
            >
              <Entry entry={entry} />
            </li>
          ))}
        </ul>
      </Band>
    </main>
  );
}

/** Where the project is now, so the page opens on the answer to "what's new?". */
function Latest({ entry }: { entry: ChangelogEntry }) {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">Latest</p>

      <div className="mt-3 border-t border-panel-border/70 pt-3">
        <Title entry={entry} />
        <p className="mt-1.5 text-[11px] text-muted">{formatDay(entry.date)}</p>
      </div>
    </div>
  );
}

/** One entry: its version and title, the day it landed, then its paragraphs. */
function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <>
      <Title entry={entry} />

      <p className="mt-1.5 text-[11px] text-muted">{formatDay(entry.date)}</p>

      {entry.body.map((paragraph, index) => (
        <p
          key={index}
          className="mt-2 text-[12px] leading-relaxed text-muted-foreground md:w-3/4"
        >
          <Ticks text={paragraph} />
        </p>
      ))}
    </>
  );
}

/**
 * The version and the subject on one line, the version first. They wrap as a
 * pair rather than as a block: on a narrow screen the number keeps the
 * subject's first line company instead of standing alone above it.
 */
function Title({ entry }: { entry: ChangelogEntry }) {
  return (
    <p className="text-[13px] leading-relaxed text-foreground">
      <span className="mr-3 text-muted tabular-nums">{entry.version}</span>
      {entry.title}
    </p>
  );
}
