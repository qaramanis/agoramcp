import type { Metadata } from "next";
import { Grid, gutterClass } from "@/components/layout/grid";
import Playground from "@/components/playground/playground";
import { loadCatalogue } from "@/data/catalogue";

export const metadata: Metadata = {
  title: "View live — agoramcp",
  description: "Call the mounted MCP tools from the browser and read the real response.",
};

/**
 * Rendered per request, never prerendered: the tool list is the MCP server's,
 * and a page built when the server was down would carry that answer for good.
 * The read itself is cached for a minute, so this is not a fetch per view.
 */
export const revalidate = 0;

export default async function LivePage() {
  const catalogue = await loadCatalogue();

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <Grid inset={false}>
        <header className="col-span-12 col-start-1 mb-8 md:col-span-6">
          <p className="text-[10px] tracking-[0.3em] text-accent uppercase">
            View live
          </p>
          <h1 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
            The tools, live in action.
          </h1>
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            Every available tool an assistant can call is found here. Pick a
            source, edit the arguments, send the call and view the official
            response.
          </p>
        </header>

        {/* All twelve, so the console's own grid inside is the page's. */}
        <div className="col-span-12 col-start-1">
          <Playground countries={catalogue.countries} unavailable={catalogue.unavailable} />
        </div>
      </Grid>
    </main>
  );
}
