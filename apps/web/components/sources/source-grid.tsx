import Section from "@/components/layout/grid";
import SourceSquares from "./source-squares";

/**
 * A fixed 10 × 2 grid of the sources, on the ten content columns.
 */
export default function SourceGrid() {
  return (
    // The rule runs the full width of the viewport, outside the gutters: it
    // marks where the hero ends, and the hero's shader has already faded to
    // the page background by then.
    <Section ariaLabel="Sources">
      <h2 className="col-span-12 text-2xl font-bold tracking-tight text-foreground md:col-span-10">
        Sources
      </h2>
      <p className="col-span-12 mt-3 text-[13px] text-muted-foreground md:col-span-4">
        Official registries and publishers, mounted one MCP server at a time.
      </p>

      {/* Ten columns, and the squares divide them ten ways — so a square is
          one column wide and the grid inside lands on the page's own. */}
      <div className="col-span-12 md:col-span-10">
        <SourceSquares />
      </div>
    </Section>
  );
}
