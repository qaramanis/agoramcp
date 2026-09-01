import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { columnGapClass, Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import Block from "@/components/mcp/block";
import CodeBlock from "@/components/mcp/code-block";
import { Code, Shape } from "@/components/mcp/inline";
import Output from "@/components/mcp/output";
import {
  API_PATTERN,
  DISCOVER_REQUEST,
  DISCOVER_RESPONSE,
  ENVELOPE,
  ERROR_CODES,
  ERROR_RESPONSE,
  ERROR_STATUS,
  FIRST_REQUEST,
  FIRST_RESPONSE,
  GET_REQUEST,
  POST_REQUEST,
  RATE_LIMIT_PER_MINUTE,
} from "@/data/api";

export const metadata: Metadata = {
  title: "API — agoramcp",
  description:
    "Query Greek open government data over plain HTTP. The same tools the MCP servers mount, one GET each — no key, no account, attribution in every response.",
};

export default function ApiPage() {
  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The /mcp hero's shape: copy on the left five columns, the thing
          itself on the right six. Here the thing is a request that works. */}
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            {/*<p className="text-[10px] tracking-[0.3em] text-accent uppercase">
              API
            </p>*/}
            <h1 className="mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              The same tools, without an agent.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Every tool the MCP servers mount also answers a plain HTTP
              request, at an address you can type. For a script, a notebook, a
              cron job or a backend — anything that needs an answer rather than
              a conversation. Same sources, same attribution, no key and no
              account.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              An agent asks questions; a script needs an answer at three in the
              morning. This is the address it calls.
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            <FirstRequest />
          </div>
        </Grid>
      </header>

      <Discover />
      <Call />
      <Limits />
      <Elsewhere />
    </main>
  );
}

/** One request and what came back, so the page opens on proof rather than a promise. */
function FirstRequest() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] text-muted">A first request</p>
        <div className="mt-2">
          <CodeBlock code={FIRST_REQUEST} label="the first request" />
        </div>
      </div>
      <div>
        <p className="text-[11px] text-muted">The response, trimmed</p>
        <div className="mt-2">
          <Output code={FIRST_RESPONSE} />
        </div>
      </div>
    </div>
  );
}

/** Section prose, on six of the band's eight columns. */
function Prose({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`col-span-8 col-start-1 text-[13px] leading-relaxed text-muted-foreground md:col-span-6 ${className}`}
    >
      {children}
    </p>
  );
}

function Discover() {
  return (
    <Band label="" title="The address describes itself.">
      <Prose className="mt-3">
        One request, <Code>/gr/api</Code>, lists every source a country mounts
        and where each of its tools answers. One level down,{" "}
        <Code>/gr/api/diavgeia</Code> adds each tool&apos;s input schema and the
        example it ships with — enough to build a query string, or a form, for
        a tool nobody told you about. The live console on this site is built
        from the same description.
      </Prose>

      <div className="col-span-8 col-start-1 mt-6 flex flex-col gap-3">
        <CodeBlock code={DISCOVER_REQUEST} label="the discovery request" />
        <Output code={DISCOVER_RESPONSE} />
      </div>
    </Band>
  );
}

function Call() {
  return (
    <Band label="" title="Arguments in, records out.">
      <div className="col-span-8 col-start-1 mt-8 flex flex-col gap-10">
        <Block
          title="The address"
          note="Country, source, tool — the same three names the MCP mounts use, with the tool as the last segment because there is no session to choose it in."
        >
          <Code>
            <span className="text-[13px] tracking-tight">
              <Shape pattern={API_PATTERN} />
            </span>
          </Code>
        </Block>

        <Block
          title="The arguments"
          note={
            <>
              <Code>GET</Code> takes them as query parameters, coerced to what
              the schema declares — <Code>size=5</Code> is a number, a bare{" "}
              <Code>includeInactive</Code> is true. <Code>POST</Code> takes one
              JSON object instead, for a long query or when you would rather not
              encode Greek into a URL — query values are URL-encoded, which
              every HTTP library does for you and curl does with{" "}
              <Code>--data-urlencode</Code>. Either way, a parameter the tool
              does not declare is a 400, so a typo cannot silently widen a
              search.
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <CodeBlock code={GET_REQUEST} label="the GET example" />
            <CodeBlock code={POST_REQUEST} label="the POST example" />
          </div>
        </Block>

        <Block
          title="The response"
          note={
            <>
              An envelope around <Code>data</Code>, the tool&apos;s own result —
              the same object an assistant reads over MCP. The rest is
              provenance, on every response: an MCP session is told the licence
              once when it connects; a stateless request has to be told every
              time. Show <Code>attribution</Code> wherever you show the data.
            </>
          }
        >
          <dl className={`grid grid-cols-8 gap-y-2 ${columnGapClass}`}>
            {ENVELOPE.map((field) => (
              <div
                key={field.key}
                className="col-span-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 md:col-span-6"
              >
                <dt className="shrink-0">
                  <Code>{field.key}</Code>
                </dt>
                <dd className="text-[12px] leading-relaxed text-muted-foreground">
                  {field.meaning}
                </dd>
              </div>
            ))}
          </dl>
        </Block>

        <Block
          title="When it goes wrong"
          note={
            <>
              One shape for every failure, and the status says which kind. The
              message is written for a person and <Code>details</Code>, where
              there is one, names the field, so a script can log the first and
              branch on <Code>code</Code>.
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Output code={ERROR_RESPONSE} status={ERROR_STATUS} />

            <dl className={`grid grid-cols-8 gap-y-1.5 ${columnGapClass}`}>
              {ERROR_CODES.map((entry) => (
                <div
                  key={entry.code}
                  className="col-span-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 md:col-span-6"
                >
                  <dt className="flex shrink-0 items-baseline gap-2">
                    <span className="text-[12px] text-muted tabular-nums">
                      {entry.status}
                    </span>
                    <Code>{entry.code}</Code>
                  </dt>
                  <dd className="text-[12px] leading-relaxed text-muted-foreground">
                    {entry.meaning}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Block>
      </div>
    </Band>
  );
}

/** Four facts, no marketing. */
const LIMITS: { title: string; body: ReactNode }[] = [
  {
    title: "No key",
    body: "Nothing to sign up for and nothing to send. The address is the whole contract.",
  },
  {
    title: `${RATE_LIMIT_PER_MINUTE} requests a minute`,
    body: (
      <>
        Per client, per source — a script hammering Διαύγεια does not spend
        another registry&apos;s allowance. Every response reports the budget in{" "}
        <Code>RateLimit-*</Code> headers; past it, a <Code>429</Code>.
      </>
    ),
  },
  {
    title: "Cached where the registry is slow",
    body: (
      <>
        Each tool caches its answer for a lifetime the source sets, and a
        successful <Code>GET</Code> says so in <Code>Cache-Control</Code>.
        Repeating a call costs the registry nothing.
      </>
    ),
  },
  {
    title: "Read-only",
    body: "It cannot write to a registry, and it returns only what the registry publishes. The licence in every response is the registry's, not ours.",
  },
];

function Limits() {
  return (
    <Band label="" title="What it will and won't do.">
      <ul className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
        {LIMITS.map((limit) => (
          <li key={limit.title}>
            <p className="text-[13px] text-foreground">{limit.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {limit.body}
            </p>
          </li>
        ))}
      </ul>
    </Band>
  );
}

/** The way out, in both directions the site offers. */
const EXITS: { title: string; description: string; href: string }[] = [
  {
    title: "Rather use an agent?",
    description: "Point Claude, Cursor or Codex at the same tools over MCP.",
    href: "/mcp",
  },
  {
    title: "Try a call in the browser",
    description: "Pick a tool, edit the arguments, read the real response.",
    href: "/live",
  },
];

function Elsewhere() {
  return (
    <Band label="" title="Two other ways in.">
      {EXITS.map((exit) => (
        <Link
          key={exit.href}
          href={exit.href}
          className="group col-span-8 col-start-1 mt-8 flex flex-col gap-1 md:col-span-3"
        >
          <span className="flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 group-hover:text-accent">
            {exit.title}
            <ArrowUpRight size={12} className="shrink-0" />
          </span>
          <span className="text-[12px] leading-relaxed text-muted-foreground">
            {exit.description}
          </span>
        </Link>
      ))}
    </Band>
  );
}
