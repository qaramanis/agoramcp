import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import Addresses from "@/components/directory/addresses";
import Breadcrumb from "@/components/directory/breadcrumb";
import ToolReference from "@/components/directory/tool-reference";
import Unavailable from "@/components/directory/unavailable";
import { Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Code } from "@/components/mcp/inline";
import { allPath, findCountry, findSource, loadDirectory } from "@/data/directory";
import { count } from "@/data/format";

/** Per request, like `/all`: the tools are the MCP server's. */
export const revalidate = 0;

export async function generateMetadata({
  params,
}: PageProps<"/all/[country]/[source]">): Promise<Metadata> {
  const { country: code, source: id } = await params;
  const country = findCountry(await loadDirectory(), code);
  const source = country && findSource(country, id);
  if (!source) return { title: "Not in the catalogue - agoramcp" };
  return { title: `${source.name} - agoramcp`, description: source.summary };
}

export default async function SourcePage({ params }: PageProps<"/all/[country]/[source]">) {
  const { country: code, source: id } = await params;
  const directory = await loadDirectory();

  if (directory.unavailable) {
    return (
      <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
        <Unavailable message={directory.unavailable} />
      </main>
    );
  }

  const country = findCountry(directory, code);
  const source = country && findSource(country, id);
  if (!country || !source) notFound();

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <Grid inset={false} className="items-start gap-y-10">
        <header className="col-span-12 col-start-1 md:col-span-5">
          <Breadcrumb
            trail={[
              { label: "All sources", href: allPath() },
              { label: country.name, href: allPath(country.code) },
            ]}
            current={source.name}
          />
          <h1 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
            {source.name}
          </h1>
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            {source.description}
          </p>

          {/* The licence facts, as the source declares them. Attribution is a
              condition of the licence, so it is a fact here and not a footnote. */}
          <dl className="mt-6 flex flex-col gap-2">
            <Fact label="Publisher">{source.publisher}</Fact>
            <Fact label="Licence">{source.license}</Fact>
            <Fact label="Attribution">{source.attribution}</Fact>
            <Fact label="Upstream">
              <a
                href={source.upstreamUrl}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex max-w-full items-center gap-1 text-foreground transition-colors duration-300 hover:text-accent"
              >
                <span className="truncate">{source.upstreamUrl}</span>
                <ArrowUpRight size={12} className="shrink-0" />
              </a>
            </Fact>
          </dl>
        </header>

        <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
          <Addresses
            endpoint={source.endpoint}
            api={source.api}
            note={
              <>
                Its own server, with the tools under their plain names. On{" "}
                <Link
                  href={allPath(country.code)}
                  className="text-foreground transition-colors duration-300 hover:text-accent"
                >
                  {country.name}
                </Link>
                &apos;s server the same tools answer as <Code>{source.prefix}…</Code>.
              </>
            }
          />
        </div>
      </Grid>

      <Band ariaLabel="Tools" title="Tools">
        <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
          {count(source.tools.length, "tool")}, each with the description a
          model is given, its arguments and the example it ships with. Over HTTP
          a tool answers at <Code>{source.api}/{"{tool}"}</Code>; over MCP, as
          itself.
        </p>

        {/* An index first: a source runs to seventeen tools, and the one you
            came for is somewhere down the page. */}
        <ul className="col-span-8 col-start-1 mt-6 flex flex-wrap gap-x-3 gap-y-1.5">
          {source.tools.map((tool) => (
            <li key={tool.name}>
              <a
                href={`#${tool.name}`}
                className="text-[11px] text-muted-foreground transition-colors duration-300 hover:text-accent"
              >
                {tool.name}
              </a>
            </li>
          ))}
        </ul>

        <div className="col-span-8 col-start-1 mt-10 flex flex-col gap-10">
          {source.tools.map((tool) => (
            <ToolReference key={tool.name} tool={tool} />
          ))}
        </div>
      </Band>
    </main>
  );
}

/** One licence fact: a fixed-width label and the value beside it. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="w-20 shrink-0 text-[11px] leading-relaxed text-muted">{label}</dt>
      <dd className="min-w-0 text-[12px] leading-relaxed text-foreground">{children}</dd>
    </div>
  );
}
