import Section from "@/components/layout/grid";
import SourceSquares from "./source-squares";

/**
 * A fixed 10 × 2 grid of the sources, on the ten content columns.
 */
export default function SourceGrid() {
  return (
    // borderTop off: the hero ends in the shader's falloff, and a rule across
    // it reads as a seam.
    <Section
      ariaLabel="Sources"
      borderTop={false}
      innerClassName="col-span-12 md:col-span-10"
    >
      <h2 className="text-2xl font-bold tracking-tight text-foreground">Sources</h2>
      <p className="mt-3 max-w-md text-[13px] text-muted-foreground">
        Official registries and publishers, mounted one MCP server at a time.
      </p>

      <SourceSquares />
    </Section>
  );
}
