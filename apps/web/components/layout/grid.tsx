import type { ReactNode } from "react";

/**
 * The app-wide 12 column grid. Every section lays its content out on these
 * columns and nothing sets its own horizontal padding, so blocks in different
 * sections line up down the page.
 *
 * `Grid` is the bare row — use it when a block needs to place children on
 * specific columns (the footer does). `Section` is the common case: a page
 * band whose children are placed on the columns for it, inset by one.
 */

/** Page gutters. Kept here so one edit re-aligns the whole app. */
export const gutterClass = "px-6 md:px-12 lg:px-20";

/**
 * The column gaps on their own. A block that has to sub-divide itself reuses
 * these rather than picking its own: given the same gaps and a column count
 * that divides the block's span, its columns land on the page's columns
 * exactly. Row spacing is a block's own business — the grid is horizontal.
 */
export const columnGapClass = "gap-x-1 md:gap-x-2 lg:gap-x-4";

/**
 * Column gaps. Deliberately tight — the grid is for alignment, not air.
 *
 * Columns only: the grid is a horizontal system, and a row gap borrowed from
 * the column rhythm is the wrong size for every stack that ever lands in one.
 * A block that wraps onto a second row sets its own `gap-y-*`, which then has
 * nothing here to conflict with.
 */
export const gridClass = `grid grid-cols-12 ${columnGapClass}`;

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
}

export default function Section({
  children,
  ariaLabel,
  py = "py-24",
  borderTop = true,
  className,
}: SectionProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={`${py} ${gutterClass} ${
        borderTop ? "border-t border-panel-border/50" : ""
      } ${className ?? ""}`}
    >
      {/* Children go straight onto the columns rather than into a wrapper:
          a section's blocks each declare their own span, and the inset rule
          above starts them all on column 2. */}
      <Grid>{children}</Grid>
    </section>
  );
}
