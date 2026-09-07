import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import CodeBlock from "@/components/mcp/code-block";
import { Code } from "@/components/mcp/inline";
import { count } from "@/data/format";
import {
  allSources,
  loadLicenses,
  type LicenseGroup,
  type LicenseSource,
} from "@/data/licenses";

export const metadata: Metadata = {
  title: "Licences — agoramcp",
  description:
    "What each source's licence permits, what it asks of you in return, and the exact line to credit every publisher with.",
};

/**
 * Per request, like the catalogue: the licences are the sources' own, read off
 * the running server, and a page built while the server was down would carry
 * that answer for good. The read itself is cached for a minute.
 */
export const revalidate = 0;

export default async function LicensesPage() {
  const { groups, unavailable } = await loadLicenses();
  const sources = allSources(groups);

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              The data is theirs. So are the terms.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              agoramcp publishes nothing of its own. Every record comes from an
              official registry under that registry&apos;s licence, and the
              licence travels with it — into the briefing an assistant is given
              on connecting, and into the envelope of every HTTP response.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              This page is what those terms actually ask of you, and the line to
              show when you show the data. The catalogue lists each
              source&apos;s licence as a fact; here it is grouped by what you
              have to do about it.
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            {unavailable ? (
              <Unreachable message={unavailable} />
            ) : (
              <Summary groups={groups} />
            )}
          </div>
        </Grid>
      </header>

      {groups.length > 0 && (
        <>
          <Band ariaLabel="Terms" title="What each licence asks of you.">
            <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
              Read top to bottom: the terms you can act on straight away, then
              the ones you have to check record by record, then the ones to ask
              about before you republish.
            </p>

            <div className="col-span-8 col-start-1 mt-8 flex flex-col gap-10">
              {groups.map((group) => (
                <Terms key={group.title} group={group} />
              ))}
            </div>
          </Band>

          <Band
            id="attribution"
            ariaLabel="Attribution"
            title="The line to credit them with."
          >
            <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
              Each publisher&apos;s own wording, untransliterated — a licence
              asks for the line it wrote, not for our reading of it. The same
              string arrives as <Code>attribution</Code> on every{" "}
              <Link
                href="/api"
                className="text-foreground transition-colors duration-300 hover:text-accent"
              >
                HTTP response
              </Link>
              , so a script can carry it without this page.
            </p>

            <div className="col-span-8 col-start-1 mt-8 flex flex-col gap-8">
              {sources.map((source) => (
                <div key={`${source.country}/${source.id}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={source.href}
                      className="group flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
                    >
                      {source.name}
                      <ArrowUpRight size={12} className="shrink-0" />
                    </Link>
                    <a
                      href={source.upstreamUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-muted transition-colors duration-300 hover:text-accent"
                    >
                      {source.upstreamUrl}
                    </a>
                  </div>

                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    Published by {source.publisher}.
                  </p>

                  <div className="mt-2">
                    <CodeBlock
                      code={source.attribution}
                      label={`the attribution for ${source.name}`}
                      wrap
                    />
                  </div>
                </div>
              ))}
            </div>
          </Band>
        </>
      )}

      <Ours />
    </main>
  );
}

/** Every licence in play, and how much of the catalogue sits under each. */
function Summary({ groups }: { groups: LicenseGroup[] }) {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        In play
      </p>

      {groups.map((group) => (
        <div
          key={group.title}
          className="mt-3 border-t border-panel-border/70 pt-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-[13px] text-foreground">{group.title}</p>
            <p className="text-[11px] text-muted">
              {count(group.sources.length, "source")}
            </p>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {group.sources.map((source) => source.name).join(", ")}
          </p>
        </div>
      ))}
    </div>
  );
}

/** One licence: what it is, what it asks, and who is under it. */
function Terms({ group }: { group: LicenseGroup }) {
  return (
    <div>
      <p className="text-[13px] text-foreground">{group.title}</p>

      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground md:w-3/4">
        {group.terms}
      </p>

      {/* What the sources themselves declare, on its own line rather than as a
          chip beside the heading: some of these are a sentence, not an SPDX
          id. It is the string the catalogue shows and every API response
          carries. Shared where the group agrees on it, and beside each source
          where it does not — two registries can both record no licence and
          mean two different things by it. */}
      {group.declared && group.declared !== group.title && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted md:w-3/4">
          Declared as <Code>{group.declared}</Code>
        </p>
      )}

      {group.declared ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {group.sources.map((source) => (
            <SourceLink key={`${source.country}/${source.id}`} source={source} />
          ))}
          {group.url && <Canonical url={group.url} />}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {group.sources.map((source) => (
            <div key={`${source.country}/${source.id}`}>
              <SourceLink source={source} />
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted md:w-3/4">
                <Code>{source.license}</Code>
              </p>
            </div>
          ))}
          {group.url && (
            <div className="mt-1">
              <Canonical url={group.url} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceLink({ source }: { source: LicenseSource }) {
  return (
    <Link
      href={source.href}
      className="w-fit text-[12px] text-foreground transition-colors duration-300 hover:text-accent"
    >
      {source.name}
    </Link>
  );
}

/** The licence's own text, where it is a published one. */
function Canonical({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex w-fit items-center gap-1 text-[11px] text-muted transition-colors duration-300 hover:text-accent"
    >
      The licence itself
      <ArrowUpRight size={11} className="shrink-0" />
    </a>
  );
}

/** What is ours, which is deliberately very little. */
function Ours() {
  return (
    <Band ariaLabel="What we claim" title="What agoramcp claims.">
      <ul className="col-span-8 col-start-1 mt-8 flex flex-col gap-6 md:col-span-6">
        <li>
          <p className="text-[13px] text-foreground">Nothing over the data</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Adapting a registry is not authorship. The records are returned as
            the publisher wrote them, under the publisher&apos;s licence, and no
            further condition is added on top.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">
            Transliteration is for the page only
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Greek names are written in Latin script on this site so a reader
            without Greek can say them. Nothing in a response is transliterated
            — subjects, bodies and attribution lines all come back in the script
            the registry keeps them in.
          </p>
        </li>
        <li>
          <p className="text-[13px] text-foreground">
            Publisher marks belong to their publishers
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Logos shown on this site are each publisher&apos;s own, used to
            identify the source of the data and for nothing else.
          </p>
        </li>
      </ul>
    </Band>
  );
}

/** The server did not answer, so the page cannot say whose terms apply. */
function Unreachable({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
        In play
      </p>
      <p className="mt-3 border-t border-panel-border/70 pt-3 text-[12px] leading-relaxed text-warn">
        {message} The licences are read off the running server, so this list
        cannot be shown right now — the terms have not changed, only our ability
        to list them.
      </p>
    </div>
  );
}
