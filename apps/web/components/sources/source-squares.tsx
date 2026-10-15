"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { columnGapClass } from "@/components/layout/grid";
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

/** Between one diagonal of squares and the next as the grid comes in. */
const STAGGER_MS = 30;
/** `--ease-out` from globals.css: the Web Animations API takes the curve, not the token. */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

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
  const gridRef = useRef<HTMLDivElement>(null);

  // The squares come in once, the first time the grid scrolls into view: each
  // rises 8px into place, a diagonal at a time from the top left, so the set
  // has landed inside 600ms. A grid already on screen when the page opens is
  // left alone rather than blinked out under the reader, and without
  // JavaScript nothing is hidden at all. Under reduced motion it is a fade.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (grid.getBoundingClientRect().top < window.innerHeight) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Four columns on a phone and ten from md, so read the ones laid out.
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;

    // Created paused, so each square holds its first frame (hidden) while it
    // is still below the fold, and plays when the grid is properly in view.
    const animations = Array.from(grid.children).map((square, index) => {
      const diagonal = Math.floor(index / columns) + (index % columns);
      const animation = square.animate(
        reduce
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: "translateY(8px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
        {
          duration: 300,
          delay: diagonal * STAGGER_MS,
          easing: EASE_OUT,
          fill: "backwards",
        },
      );
      animation.pause();
      return animation;
    });

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        animations.forEach((animation) => animation.play());
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    observer.observe(grid);
    // Cancelled too, or a paused set left behind (React runs this twice in
    // development) would hold the squares hidden for good.
    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

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
        ref={gridRef}
        className={`mt-8 grid grid-cols-4 gap-y-1 md:grid-cols-10 md:gap-y-2 lg:gap-y-4 ${columnGapClass}`}
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
            more coming soon
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
