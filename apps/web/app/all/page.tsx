import type { Metadata } from "next";
import Breadcrumb from "@/components/directory/breadcrumb";
import Catalogue from "@/components/directory/catalogue";
import { gutterClass } from "@/components/layout/grid";
import { loadDirectory, toCatalogue } from "@/data/directory";

export const metadata: Metadata = {
  title: "All sources - agoramcp",
  description:
    "Every country agoramcp serves and every official registry it mounts, with the tools each one answers.",
};

/**
 * Rendered per request, never prerendered, for the reason /live gives: the
 * list is the MCP server's, and a page built when the server was down would
 * carry that answer for good. The read itself is cached for a minute.
 */
export const revalidate = 0;

export default async function AllPage() {
  const directory = await loadDirectory();

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The copy is handed to the client catalogue so it stays
          server-rendered; the search field beside it drives the lists. */}
      <Catalogue
        countries={toCatalogue(directory.countries)}
        unavailable={directory.unavailable}
        header={
          <>
            {/* The root of the catalogue — the crumb the country and source
                pages point back to, shown here as the current one. */}
            <Breadcrumb trail={[]} current="All sources" />
            <h1 className="mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Every source, in one place.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Every country agoramcp serves and every official registry it
              mounts. Search for one, or open a country to see its sources and a
              source to read the full reference of its tools.
            </p>
          </>
        }
      />
    </main>
  );
}
