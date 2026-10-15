"use client";

import { usePathname } from "next/navigation";

/**
 * The page fade, on every navigation at every depth.
 *
 * A root template is remounted only when the segment directly beneath it
 * changes — /mcp to /api does it, /all to /all/gr does not, because both are
 * still "all" as far as the root router is concerned. Left to Next's own key,
 * this would fade the top-level pages and nothing under them: the catalogue's
 * countries and sources, and one use case to the next, would all snap in.
 *
 * So the whole pathname is the key. A new path is a new element, mounted from
 * nothing, whichever segment of it changed. Search parameters are deliberately
 * not part of it — `usePathname` leaves them out — so the live console can
 * rewrite its query without the page blinking underneath it.
 *
 * The fade itself is CSS: `starting:` is the element's first frame, so it
 * runs from the first paint of the server's HTML. Holding the page at zero
 * until a client effect lifted it left everything under the nav blank until
 * the JavaScript had loaded, and for good without it.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className="transition-opacity duration-200 ease-out starting:opacity-0"
    >
      {children}
    </div>
  );
}
