import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Ticks } from "@/components/mcp/inline";
import { conventions, glossary, routes } from "@/data/documentation";

export const metadata: Metadata = {
  title: "Documentation - agoramcp",
  description:
    "The map and the vocabulary: what every word on this site means, the rules that hold across all of it, and which page answers which question.",
};

export default function DocsPage() {
  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The hero shape the other guides use: copy on the left five columns,
          the thing itself on the right six. Here the thing is the way in. */}
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Where everything is written down.
            </h1>
            <p className="mt-4 font-sans text-[14px] leading-relaxed text-muted-foreground">
              Every part of agoramcp is documented on the page that owns it:
              connecting on the quickstart, the servers on the MCP page, the
              HTTP contract on the API page, the tools themselves in the
              catalogue. Nothing is explained twice.
            </p>
            <p className="mt-4 font-sans text-[14px] leading-relaxed text-muted-foreground">
              What is left over is this page: the words those pages use without
              stopping to define them, the rules that hold across all of them,
              and a straight answer to which one you want.
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            <StartHere />
          </div>
        </Grid>
      </header>

      <Words />
      <Rules />
      <SiteMap />
    </main>
  );
}

/** The three doors, in the order most people want them. */
const START: { title: string; body: string; href: string }[] = [
  {
    title: "Connect a client",
    body: "One command, or one entry in a config file you already have.",
    href: "/quickstart",
  },
  {
    title: "See what there is to ask",
    body: "Every country, source and tool, with arguments and an example each.",
    href: "/all",
  },
  {
    title: "Call one without an agent",
    body: "The same tools over plain HTTP, for a script or a notebook.",
    href: "/api",
  },
];

function StartHere() {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        Start here
      </p>

      {START.map((door) => (
        <Link
          key={door.href}
          href={door.href}
          className="group mt-3 block border-t border-panel-border/70 pt-3"
        >
          <span className="flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 group-hover:text-accent">
            {door.title}
            <ArrowUpRight size={12} className="shrink-0" />
          </span>
          <span className="mt-1 block font-sans text-[14px] leading-relaxed text-muted-foreground">
            {door.body}
          </span>
        </Link>
      ))}
    </div>
  );
}

function Words() {
  return (
    <Band ariaLabel="Vocabulary" title="The words this site uses.">
      <p className="col-span-8 col-start-1 mt-3 font-sans text-[14px] leading-relaxed text-muted-foreground md:col-span-6">
        A handful of nouns carry most of the documentation. Each one is defined
        here once, and used everywhere else without ceremony.
      </p>

      <dl className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
        {glossary.map((term) => (
          <div key={term.term}>
            <dt className="text-[13px] text-foreground">{term.term}</dt>
            <dd className="mt-1 font-sans text-[14px] leading-relaxed text-muted-foreground">
              <Ticks text={term.definition} />
            </dd>
            {/* Where the word is used in anger, as a destination rather than a
                sentence — eight definitions in a row, and a repeated clause
                under each one would be the loudest thing on the page. */}
            {term.where && (
              <dd className="mt-1.5">
                <Link
                  href={term.where.href}
                  className="group flex w-fit items-center gap-1 text-[11px] text-muted transition-colors duration-300 hover:text-accent"
                >
                  {term.where.label}
                  <ArrowUpRight size={11} className="shrink-0" />
                </Link>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </Band>
  );
}

function Rules() {
  return (
    <Band ariaLabel="Conventions" title="Rules that hold everywhere.">
      <p className="col-span-8 col-start-1 mt-3 font-sans text-[14px] leading-relaxed text-muted-foreground md:col-span-6">
        True of every source, every tool and every address, so no other page
        has to say them again.
      </p>

      <ul className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
        {conventions.map((convention) => (
          <li key={convention.title}>
            <p className="text-[13px] text-foreground">{convention.title}</p>
            <p className="mt-1 font-sans text-[14px] leading-relaxed text-muted-foreground">
              <Ticks text={convention.body} />
            </p>
          </li>
        ))}
      </ul>
    </Band>
  );
}

/**
 * The map, and the reason this page exists. Each row says what a page answers
 * and what it deliberately leaves to another — which is the rule the site is
 * built on rather than a description of it.
 */
function SiteMap() {
  return (
    <Band ariaLabel="Site map" title="Which page answers what.">
      <p className="col-span-8 col-start-1 mt-3 font-sans text-[14px] leading-relaxed text-muted-foreground md:col-span-6">
        One job each. If two pages would both answer your question, the one
        listed here is the one that does it properly.
      </p>

      <div className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
        {routes.map((route) => (
          <Link key={route.href} href={route.href} className="group block">
            <span className="flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 group-hover:text-accent">
              {route.title}
              <ArrowUpRight size={12} className="shrink-0" />
            </span>
            <span className="mt-1 block font-sans text-[14px] leading-relaxed text-foreground">
              {route.answers}
            </span>
            <span className="mt-0.5 block font-sans text-[14px] leading-relaxed text-muted-foreground">
              {route.boundary}
            </span>
          </Link>
        ))}
      </div>
    </Band>
  );
}
