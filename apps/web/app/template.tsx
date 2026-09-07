"use client";

import { useEffect, useState } from "react";
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
 * So the whole pathname is the key. A new path is a new `Fade`, mounted from
 * nothing, whichever segment of it changed. Search parameters are deliberately
 * not part of it — `usePathname` leaves them out — so the live console can
 * rewrite its query without the page blinking underneath it.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return <Fade key={pathname}>{children}</Fade>;
}

function Fade({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // One painted frame at zero, so the transition has somewhere to start
    // from — set in the same tick and there is nothing to animate.
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="transition-opacity duration-300 ease-out"
      style={{
        opacity: visible ? 1 : 0,
      }}
    >
      {children}
    </div>
  );
}
