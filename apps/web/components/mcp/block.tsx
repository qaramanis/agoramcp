import type { ReactNode } from "react";
import { columnGapClass } from "@/components/layout/grid";

/**
 * A titled step: label, optional gloss, then the block being handed over.
 * Eight columns carrying the page's gaps, like the guides it sits among, so
 * the gloss keeps its measure from the grid rather than from a max-width.
 */
export default function Block({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`grid grid-cols-8 ${columnGapClass}`}>
      <p className="col-span-8 col-start-1 text-[12px] text-foreground">
        {title}
      </p>

      {note && (
        <p className="col-span-8 col-start-1 mt-1.5 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
          {note}
        </p>
      )}

      <div className="col-span-8 col-start-1 mt-2">{children}</div>
    </div>
  );
}
