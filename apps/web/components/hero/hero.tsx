import Link from "next/link";
import { Grid, gutterClass } from "@/components/layout/grid";
import EclipseCanvas from "./eclipse-canvas";

/**
 * The hero's own bottom edge. Reaches full transparency at the section
 * boundary, so the shader is already gone by the time the next section begins.
 */
const BOTTOM_FADE =
  "linear-gradient(to bottom, #000 0%, #000 62%, rgba(0,0,0,0.55) 82%, transparent 100%)";

export default function Hero() {
  return (
    // No overflow-hidden: clipping the canvas to the section cuts the corona
    // off at the hero's edges. `body` already carries overflow-x: hidden, so
    // the half of the disc that sits past the viewport costs no scrollbar.
    // `svh`, the viewport with the phone's browser bars showing: `100vh` is
    // the one with them hidden, so the hero ran under the bottom bar.
    <section className="relative h-svh w-full">
      {/* Both layers fade out over the last third of the hero. The canvas is
          opaque — it paints its own near-black — so without this it ends on a
          hard horizontal line exactly where the next section starts. Masking
          the wrapper rather than the canvas keeps this fade and the canvas's
          own left-edge fade as separate, multiplying masks, which needs no
          mask-composite support.

          Not on a phone. The glow and the canvas both reach half a screen
          past the right edge, and a mobile browser widens the page to fit
          them, whatever body's overflow says: the whole site is zoomed out
          and the menu button lands off screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{ maskImage: BOTTOM_FADE, WebkitMaskImage: BOTTOM_FADE }}
      >
        {/* Doubles as the WebGL fallback: if the canvas never paints, this
            alone still reads as an accent on the right. */}
        <div
          className="absolute inset-y-0 left-1/2 w-full"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(74,222,128,0.18) 0%, rgba(30,140,70,0.06) 24%, transparent 58%)",
          }}
        />

        {/* Centred in its own box, which starts at the midpoint — so the disc
            lands on the right edge of the viewport, half out of frame. The
            mask dissolves the canvas into the page background instead of
            leaving a hard seam at the 50% line. */}
        <EclipseCanvas
          className="absolute inset-y-0 left-1/2 h-full w-full"
          style={{
            maskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 14%, #000 34%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 14%, #000 34%)",
          }}
        />
      </div>

      {/* Every line of copy is its own grid child. The Grid starts them all on
          column 2, so each one only declares its width and the measure comes
          from the column count rather than an arbitrary max-width. */}
      <Grid className={`relative z-10 h-full content-center ${gutterClass}`}>
        <p className="col-span-12 text-[10px] tracking-[0.3em] text-accent uppercase md:col-span-5">
          Open government data
        </p>
        <h1 className="col-span-12 mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground md:col-span-5">
          Ask your government
          <br />a question.
        </h1>
        <p className="col-span-12 mt-4 text-[13px] leading-relaxed text-muted-foreground md:col-span-4">
          agoramcp exposes public registries as MCP servers, so any assistant
          can query spending, filings and live measurements directly. Available
          only for Greece at the moment.
        </p>
        <div className="col-span-12 mt-6 flex flex-wrap items-center gap-3 md:col-span-5">
          <Link
            href="/quickstart"
            className="w-fit rounded-md bg-accent px-6 py-3 text-[12px] font-medium text-background transition-[opacity,scale] duration-[300ms,160ms] ease-out hover:opacity-90 active:scale-[0.97]"
          >
            Get started
          </Link>
          <Link
            href="/country"
            className="w-fit rounded-md border border-panel-border px-6 py-3 text-[12px] font-medium text-muted-foreground transition-[color,border-color,scale] duration-[300ms,300ms,160ms] ease-out hover:border-accent/50 hover:text-foreground active:scale-[0.97]"
          >
            Request a country
          </Link>
        </div>
      </Grid>
    </section>
  );
}
