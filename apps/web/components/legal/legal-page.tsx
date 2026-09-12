import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Ticks } from "@/components/mcp/inline";
import { formatDay } from "@/data/format";
import type { LegalDocument, LegalSection } from "@/data/legal";

/**
 * A legal page: heading and lead on the left, the document in a few lines in
 * a panel on the right, then the sections in one band — the hero and rhythm
 * of /licenses and /changelog, so the pages the footer files together read as
 * one site. The text is `data/legal.ts`'s; nothing here is specific to
 * either page.
 */
export default function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              {document.heading}
            </h1>
            {document.lead.map((paragraph, index) => (
              <p
                key={index}
                className="mt-4 text-[13px] leading-relaxed text-muted-foreground"
              >
                {paragraph}
              </p>
            ))}
            <p className="mt-4 text-[11px] text-muted">
              Last updated {formatDay(document.updated)}
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            <InShort lines={document.inShort} />
          </div>
        </Grid>
      </header>

      <Band ariaLabel={document.bandTitle} title={document.bandTitle}>
        <ul className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
          {document.sections.map((section) => (
            <li key={section.title}>
              <Section section={section} />
            </li>
          ))}
        </ul>
      </Band>
    </main>
  );
}

/** The whole document in a few lines, so the page opens on the answer. */
function InShort({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        In short
      </p>

      {lines.map((line, index) => (
        <p
          key={index}
          className="mt-3 border-t border-panel-border/70 pt-3 text-[12px] leading-relaxed text-muted-foreground"
        >
          {line}
        </p>
      ))}
    </div>
  );
}

/** One section: its title, its paragraphs, and the page that goes further. */
function Section({ section }: { section: LegalSection }) {
  return (
    <div>
      <p className="text-[13px] text-foreground">{section.title}</p>

      {section.body.map((paragraph, index) => (
        <p
          key={index}
          className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground"
        >
          <Ticks text={paragraph} />
        </p>
      ))}

      {section.link && (
        <Link
          href={section.link.href}
          className="group mt-2 flex w-fit items-center gap-1 text-[12px] text-foreground transition-colors duration-300 hover:text-accent"
        >
          {section.link.label}
          <ArrowUpRight size={12} className="shrink-0" />
        </Link>
      )}
    </div>
  );
}
