import type { ReactNode } from "react";
import { columnGapClass, Grid } from "@/components/layout/grid";

/**
 * A page band: eyebrow, heading, then whatever the section hands over, on
 * eight of the page's twelve columns like the sections on /mcp. Shared by /api
 * and the catalogue pages so their rhythm down the page is one rhythm.
 */
export default function Band({
  label,
  ariaLabel,
  title,
  children,
}: {
  /** The eyebrow above the heading. Left out, nothing is drawn there. */
  label?: string;
  /** Names the section for assistive tech when the eyebrow does not. */
  ariaLabel?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Grid inset={false}>
      <section
        aria-label={ariaLabel ?? label}
        className={`col-span-12 col-start-1 mt-20 grid grid-cols-8 border-t border-panel-border/50 pt-10 md:col-span-8 ${columnGapClass}`}
      >
        {label && (
          <p className="col-span-8 col-start-1 text-[10px] tracking-[0.3em] text-accent uppercase">
            {label}
          </p>
        )}
        <h2 className="col-span-8 col-start-1 mt-4 text-[1.5rem] leading-[1.25] font-medium tracking-tight text-foreground">
          {title}
        </h2>
        {children}
      </section>
    </Grid>
  );
}
