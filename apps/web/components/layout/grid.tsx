import type { ReactNode } from "react";

/**
 * The app-wide 12 column grid. Every section lays its content out on these
 * columns and nothing sets its own horizontal padding, so blocks in different
 * sections line up down the page.
 *
 * `Grid` is the bare row — use it when a block needs to place children on
 * specific columns (the footer does). `Section` is the common case: a page
 * band that centres its content on the middle ten columns.
 */

/** Page gutters. Kept here so one edit re-aligns the whole app. */
export const gutterClass = "px-6 md:px-12 lg:px-20";

/** Column gaps. Deliberately tight — the grid is for alignment, not air. */
export const gridClass = "grid grid-cols-12 gap-1 md:gap-2 lg:gap-4";

/** The default content span: ten columns, one column of margin either side. */
export const contentSpanClass = "col-span-12 md:col-span-12";

/**
 * Starts every direct child on column 2. It lives on the parent so children
 * only ever declare how wide they are, never where the content column begins.
 */
export const insetClass = "md:[&>*]:col-start-2";

interface GridProps {
  children: ReactNode;
  className?: string;
  /**
   * Off for grids that place children on specific columns themselves — the
   * parent rule outranks a child's own `col-start-*`.
   */
  inset?: boolean;
}

export function Grid({ children, className, inset = true }: GridProps) {
  return (
    <div className={`${gridClass} ${inset ? insetClass : ""} ${className ?? ""}`}>
      {children}
    </div>
  );
}

interface SectionProps {
  children: ReactNode;
  ariaLabel?: string;
  py?: string;
  borderTop?: boolean;
  className?: string;
  /** Overrides the ten column default when a section needs a different span. */
  innerClassName?: string;
}

export default function Section({
  children,
  ariaLabel,
  py = "py-24",
  borderTop = true,
  className,
  innerClassName,
}: SectionProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={`${py} ${gutterClass} ${
        borderTop ? "border-t border-panel-border/50" : ""
      } ${className ?? ""}`}
    >
      <Grid>
        <div className={innerClassName ?? contentSpanClass}>{children}</div>
      </Grid>
    </section>
  );
}
