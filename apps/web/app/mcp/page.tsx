import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { columnGapClass, Grid, gutterClass } from "@/components/layout/grid";
import AgentPicker from "@/components/mcp/agent-picker";
import { Code, Shape } from "@/components/mcp/inline";
import { mounts } from "@/data/mcp";

export const metadata: Metadata = {
  title: "MCP - agoramcp",
  description:
    "Connect Claude, Cursor or any MCP client to Greek open government data. A whole country at one address, or a single registry at its own.",
};

export default function McpPage() {
  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The hero band: tall enough to stand on its own, the copy and the
          addresses side by side rather than stacked. `inset={false}` because
          the two columns place themselves — the grid's own rule would push
          both onto column 2 and give up the left edge. */}
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            {/*<p className="text-[10px] tracking-[0.3em] text-accent uppercase">
              MCP
            </p>*/}
            <h1 className="mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Your assistant, connected.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              agoramcp speaks the Model Context Protocol over Streamable HTTP.
              We offer two kind of MCP servers, country-level and specific
              source-level servers.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Country-level servers group all the available sources for the
              given country under one roof, whilst source-level servers are
              dedicated to a single source for more specific questions and
              research.
            </p>
            {/* The same primary CTA the home hero uses, so the one green
                button on a page always means the same thing. */}
            <Link
              href="/quickstart"
              className="mt-6 inline-block w-fit rounded-md bg-accent px-6 py-3 text-[12px] font-medium text-background transition-opacity duration-300 hover:opacity-90"
            >
              Connect your agent
            </Link>
          </div>

          {/* Column 7 on, so a full column of air separates it from the copy. */}
          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            <MountPaths />
          </div>
        </Grid>
      </header>

      <HowItWorks />

      <Connect />
    </main>
  );
}

/** The prose for each mount, kept with the page rather than with the data. */
const MOUNT_NOTES: Record<string, ReactNode> = {
  "/gr/mcp": (
    <>
      Every registry agoramcp mounts for that country, behind one connection:
      Greece answers at <Code>/gr/mcp</Code>. Tool names carry the registry that
      answers them, so <Code>diavgeia_get_decision</Code> is unambiguous the
      moment a second source lands beside it.
    </>
  ),
  "/gr/mcp/diavgeia": (
    <>
      A single registry on its own. For example <Code>/gr/mcp/diavgeia</Code> is
      the register every Greek public body publishes its decisions in, and its
      tools keep their plain names: <Code>get_decision</Code>. A narrower
      surface is one a model chooses better within.
    </>
  ),
};

function MountPaths() {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        Address shape
      </p>

      {mounts.map((mount) => (
        <div
          key={mount.path}
          className="mt-3 border-t border-panel-border/70 pt-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-[13px] text-muted">{mount.label}:</p>
            <Code>
              <p className="text-[13px] tracking-tight">
                <Shape pattern={mount.pattern} />
              </p>
            </Code>
          </div>

          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            {MOUNT_NOTES[mount.path]}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * One tool call, in the order it happens on the server (`apps/server/src`).
 * Kept with the page like the mount notes. Each mechanism gets a clause where
 * it occurs in the sequence and no more — the Features pages are where
 * schemas, caching and attribution each get their depth.
 */
const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Connect",
    body: (
      <>
        The address speaks Streamable HTTP and holds no session. Every request
        stands alone: a fresh server answers it and is gone once the reply is
        sent, so two clients on one address never see each other.
      </>
    ),
  },
  {
    title: "The briefing",
    body: (
      <>
        On connecting, the model is told what it has reached: the registry, who
        publishes it, its licence and how to attribute it. The country server
        adds a map of tool prefixes to registries (<Code>diavgeia_*</Code> is
        Diavgeia), so a question is routed without a call spent finding out.
      </>
    ),
  },
  {
    title: "The tools",
    body: (
      <>
        <Code>tools/list</Code> hands over every tool, each with a typed schema
        for its arguments and a line on what it answers.
      </>
    ),
  },
  {
    title: "The call",
    body: (
      <>
        <Code>tools/call</Code> runs the source&apos;s own handler against the
        upstream registry, through a cache whose lifetime the source sets per
        tool. What comes back is the registry&apos;s records, shaped for a model
        to read, as JSON.
      </>
    ),
  },
  {
    title: "When it goes wrong",
    body: (
      <>
        A bad argument or an upstream that is down comes back inside the tool
        result, marked as an error, so the model reads it and corrects itself.
        The protocol envelope stays intact and the turn goes on.
      </>
    ),
  },
];

/**
 * The request lifecycle, between what the server is (the hero) and where to
 * go to connect one (below). The quickstart owns the steps before a call and
 * the live console owns what comes back; this is the part in between.
 */
function HowItWorks() {
  return (
    <Grid inset={false}>
      <section
        aria-label="How it works"
        className={`col-span-12 col-start-1 mt-20 grid grid-cols-8 border-t border-panel-border/50 pt-10 md:col-span-8 ${columnGapClass}`}
      >
        {/*<p className="col-span-8 col-start-1 text-[10px] tracking-[0.3em] text-accent uppercase">
          How it works
        </p>*/}
        <h2 className="col-span-8 col-start-1 mt-4 text-[1.5rem] leading-[1.25] font-medium tracking-tight text-foreground">
          How it works
        </h2>
        <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
          What happens between a client opening the address and an answer
          landing in the model&apos;s context: the same steps on a country
          server and on a single source.
        </p>

        <ol className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="shrink-0 text-[13px] text-muted tabular-nums">
                {`${index + 1}.`}
              </span>
              <div>
                <p className="text-[13px] text-foreground">{step.title}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="col-span-8 col-start-1 mt-8 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
          The server is a read-only proxy. It cannot write to a registry, and it
          returns only what the registry publishes. Where a question falls
          outside the tools, the model is told to say so rather than guess.
        </p>
      </section>
    </Grid>
  );
}

/**
 * The way out. The quickstart is where the steps and the snippets live — this
 * page says what the server is and how it works, that one says how to reach
 * it — so the picker sends each client straight to its own block over there
 * rather than repeating the quickstart's own introduction here.
 */
function Connect() {
  return (
    <Grid inset={false}>
      <section
        aria-label="Connect"
        className={`col-span-12 col-start-1 mt-20 grid grid-cols-8 border-t border-panel-border/50 pt-10 md:col-span-8 ${columnGapClass}`}
      >
        {/*<p className="col-span-8 col-start-1 text-[10px] tracking-[0.3em] text-accent uppercase">
          Connect
        </p>*/}
        <h2 className="col-span-8 col-start-1 mt-4 text-[1.5rem] leading-[1.25] font-medium tracking-tight text-foreground">
          Point your agent at it.
        </h2>

        {/* Six of the section's eight, so the picker's six columns land on
            the page's — the same width the quickstart hero deals it. */}
        <div className="col-span-8 col-start-1 mt-8 md:col-span-6">
          <AgentPicker hrefBase="/quickstart" />
        </div>
      </section>
    </Grid>
  );
}
