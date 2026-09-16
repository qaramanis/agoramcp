import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Addresses from "@/components/directory/addresses";
import Breadcrumb from "@/components/directory/breadcrumb";
import { SourceRow } from "@/components/directory/rows";
import Unavailable from "@/components/directory/unavailable";
import { Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import { Code } from "@/components/mcp/inline";
import {
  allPath,
  findCountry,
  loadDirectory,
  toCatalogueSource,
  toolCount,
} from "@/data/directory";
import { count } from "@/data/format";

/** Per request, like `/all`: the country's sources are the MCP server's. */
export const revalidate = 0;

export async function generateMetadata({
  params,
}: PageProps<"/all/[country]">): Promise<Metadata> {
  const { country: code } = await params;
  const country = findCountry(await loadDirectory(), code);
  if (!country) return { title: "Not in the catalogue - agoramcp" };
  return { title: `${country.name} - agoramcp`, description: country.description };
}

export default async function CountryPage({ params }: PageProps<"/all/[country]">) {
  const { country: code } = await params;
  const directory = await loadDirectory();

  if (directory.unavailable) {
    return (
      <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
        <Unavailable message={directory.unavailable} />
      </main>
    );
  }

  const country = findCountry(directory, code);
  if (!country) notFound();

  // The name a tool goes by on the country server, from the first one there is.
  const first = country.sources.find((source) => source.tools.length > 0);
  const qualified = first ? `${first.prefix}${first.tools[0]?.name ?? ""}` : null;

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The /live header's shape, with the addresses beside it from column 7
          so a full column of air separates them from the copy. */}
      <Grid inset={false} className="items-start gap-y-10">
        <header className="col-span-12 col-start-1 md:col-span-5">
          <Breadcrumb trail={[{ label: "All sources", href: allPath() }]} current={country.name} />
          <h1 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
            {country.name}
          </h1>
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            {country.description}
          </p>
          <p className="mt-4 text-[11px] text-muted tabular-nums">
            {count(country.sources.length, "source")} · {count(toolCount(country), "tool")}
          </p>
        </header>

        <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
          <Addresses
            endpoint={country.endpoint}
            api={country.api}
            note={
              <>
                Every source below behind one connection, each tool named after
                the source that answers it
                {qualified && (
                  <>
                    {", as in "}
                    <Code>{qualified}</Code>
                  </>
                )}
                .{" "}
                <Link href="/quickstart" className="text-foreground transition-colors duration-300 hover:text-accent">
                  Connect it
                </Link>{" "}
                or{" "}
                <Link href="/live" className="text-foreground transition-colors duration-300 hover:text-accent">
                  try it live
                </Link>
                .
              </>
            }
          />
        </div>
      </Grid>

      <Band ariaLabel="Sources" title="Sources">
        <ul className="col-span-8 col-start-1 mt-8 border-b border-panel-border/50">
          {country.sources.map((source) => (
            <SourceRow key={source.id} source={toCatalogueSource(source)} showCountry={false} />
          ))}
        </ul>
      </Band>
    </main>
  );
}
