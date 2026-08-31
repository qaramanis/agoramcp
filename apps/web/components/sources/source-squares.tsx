"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import {
  SOURCE_GRID_COLUMNS,
  SOURCE_GRID_ROWS,
  sources,
  type SourceLogo,
} from "@/data/sources";

/** One column of the app grid wide, so the squares sit on the 12 column rhythm. */
const squareClass =
  "flex aspect-square items-center justify-center rounded-md border border-panel-border p-2 text-center bg-background transition-colors duration-300";

/** Only squares with something in them answer the pointer. */
const filledSquareClass = `${squareClass} hover:border-accent/50`;

/** Distance from the pointer to the label's top left corner. */
const CURSOR_OFFSET = 14;

function SourceMark({ source }: { source: SourceLogo }) {
  if (!source.logo) {
    return (
      <span className="text-[9px] leading-tight tracking-wider text-muted break-words">
        {source.short}
      </span>
    );
  }

  return (
    <Image
      src={source.logo}
      alt={source.name}
      fill
      // Publisher marks come in every polarity and aspect ratio. Grayscale plus
      // a per-logo invert flattens them into one set; they stay monochrome on
      // hover too, because the brand colours next to each other are a mess.
      unoptimized
      className={`object-contain p-3 opacity-70 grayscale transition-opacity duration-300 group-hover:opacity-100 ${
        source.invert ? "invert" : ""
      } ${source.opaque ? "mix-blend-screen" : ""}`}
    />
  );
}

export default function SourceSquares() {
  const [label, setLabel] = useState<string | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const total = SOURCE_GRID_COLUMNS * SOURCE_GRID_ROWS;
  // The last square is always "and more", so it never gets filled by a source.
  const slots = total - 1;
  const filled = sources.slice(0, slots);
  const empty = Math.max(0, slots - filled.length);

  const moveLabel = (event: { clientX: number; clientY: number }) => {
    const el = labelRef.current;
    if (!el) return;
    // Flip to the other side of the cursor rather than run off the viewport.
    const flip = event.clientX + CURSOR_OFFSET + el.offsetWidth > window.innerWidth;
    const x = flip
      ? event.clientX - CURSOR_OFFSET - el.offsetWidth
      : event.clientX + CURSOR_OFFSET;
    el.style.transform = `translate3d(${x}px, ${event.clientY + CURSOR_OFFSET}px, 0)`;
  };

  return (
    <>
      <div
        className="mt-8 grid grid-cols-5 gap-1 md:grid-cols-10 md:gap-2 lg:gap-4"
        onMouseMove={moveLabel}
        onMouseLeave={() => setLabel(null)}
      >
        {filled.map((source) => (
          <div
            key={source.name}
            className={`${filledSquareClass} group relative`}
            onMouseEnter={(e) => {
              setLabel(source.name);
              moveLabel(e);
            }}
            onMouseLeave={() => setLabel(null)}
          >
            <SourceMark source={source} />
          </div>
        ))}

        {/* Empty squares are deliberate — the shape of the set is the point,
            and each new source fills the next one. Nothing to hover, so they
            keep their border. */}
        {Array.from({ length: empty }, (_, i) => (
          <div key={`empty-${i}`} className={squareClass} aria-hidden="true" />
        ))}

        <div className={filledSquareClass}>
          <span className="text-[9px] leading-tight tracking-wider text-muted">
            more comming soon
          </span>
        </div>
      </div>

      {/* Stays mounted so it can fade, and never takes the pointer. */}
      <div
        ref={labelRef}
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed top-0 left-0 z-100 rounded border border-panel-border bg-panel px-2 py-1 text-[10px] tracking-wider whitespace-nowrap text-foreground transition-opacity duration-300 ${
          label ? "opacity-100" : "opacity-0"
        }`}
      >
        {label}
      </div>
    </>
  );
}
