import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { columnGapClass, Grid, gutterClass } from "@/components/layout/grid";
import { Code } from "@/components/mcp/inline";
import { mounts } from "@/data/mcp";

export const metadata: Metadata = {
  title: "MCP — agoramcp",
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
            <p className="text-[10px] tracking-[0.3em] text-accent uppercase">
              MCP
            </p>
            <h1 className="mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Your assistant, connected.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              agoramcp speaks the Model Context Protocol over Streamable HTTP.
              We offer two kind of MCP servers, country-level and specific
              source-level servers. Country-level servers group all the
              available sources for the given country under one roof, whilst
              source-level servers are dedicated to a single source for more
              specific questions and research.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Connect the servers is an easy task and you can find details on
              how to do so below.
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

      <Connect />
    </main>
  );
}

/** The prose for each mount, kept with the page rather than with the data. */
const MOUNT_NOTES: Record<string, ReactNode> = {
  "/gr/mcp": (
    <>
      Every registry agoramcp mounts for that country, behind one connection —
      Greece answers at <Code>/gr/mcp</Code>. Tool names carry the registry that
      answers them, so <Code>diavgeia_get_decision</Code> is unambiguous the
      moment a second source lands beside it.
    </>
  ),
  "/gr/mcp/diavgeia": (
    <>
      A single registry on its own. For example <Code>/gr/mcp/diavgeia</Code> is the
      register every Greek public body publishes its decisions in, and its tools
      keep their plain names — <Code>get_decision</Code>. A narrower surface is
      one a model chooses better within.
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
 * Prose and a single way out. The quickstart is where the steps and the
 * snippets live — this page says what the servers are, that one says how to
 * reach them.
 */
function Connect() {
  return (
    <Grid inset={false}>
      <section
        aria-label="Connect"
        className={`col-span-12 col-start-1 mt-20 grid grid-cols-8 border-t border-panel-border/50 pt-10 md:col-span-8 ${columnGapClass}`}
      >
        <p className="col-span-8 col-start-1 text-[10px] tracking-[0.3em] text-accent uppercase">
          Connect
        </p>
        <h2 className="col-span-8 col-start-1 mt-4 text-[1.5rem] leading-[1.25] font-medium tracking-tight text-foreground">
          Point your agent at it.
        </h2>
        <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
          Connect the server to the agent you already work in: Claude, Codex,
          Cursor, Windsurf etc. Every one of them takes the same address; only
          where you paste it differs. Some take it through their own interface,
          some through a file.
        </p>
      </section>
    </Grid>
  );
}

/**
 * Picks the placeholders out of a mount pattern. They carry the accent and the
 * fixed segments do not, so the line reads as a template rather than as one
 * more example URL.
 */
function Shape({ pattern }: { pattern: string }) {
  return (
    <>
      {pattern.split(/(\{[a-z]+\})/).map((part, index) => (
        <span
          key={index}
          className={part.startsWith("{") ? "text-accent" : "text-muted"}
        >
          {part}
        </span>
      ))}
    </>
  );
}
