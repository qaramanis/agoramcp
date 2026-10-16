import type { ReactNode } from "react";
import Link from "next/link";
import { Grid } from "@/components/layout/grid";

/**
 * A hero of a section's own, on `/all`: eyebrow, heading, one line of copy and
 * the landing hero's calls — the accent one jumping to the list under it, and
 * a secondary one off the page where the section has somewhere to send the
 * reader. Same five columns and the same buttons as
 * `components/hero/hero.tsx`, so a section opens the way the site itself does.
 *
 * The list is handed in as children rather than left to follow the hero, so
 * the section labels both and the jump lands inside it.
 */
export default function SectionHero({
  label,
  title,
  blurb,
  jump,
  action,
  aside,
  children,
}: {
  /** The eyebrow, and the section's name for assistive tech. */
  label: string;
  title: string;
  blurb: string;
  /** The accent call: an in-page hash, so it needs no JavaScript. */
  jump: { href: string; label: string };
  /** The secondary call, off the page. Left out, only the jump is drawn. */
  action?: { href: string; label: string };
  /**
   * What stands beside the copy, on the six columns the page hero's search
   * takes. Decoration — it is dropped rather than stacked on a phone.
   */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="mt-20 border-t border-panel-border/50 pt-10"
    >
      {/* Tall enough that the list below it is the reader's next move rather
          than something already on screen — which is what the jump is for. */}
      <div className="flex min-h-[60vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <p className="text-[10px] tracking-[0.3em] text-accent uppercase">
              {label}
            </p>
            {/* Under the page's own h1 and over the rows: a step down from the
                2.5rem the site's heroes take, a step up from a band's 1.5rem. */}
            <h2 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
              {title}
            </h2>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              {blurb}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href={jump.href}
                className="w-fit rounded-md bg-accent px-6 py-3 text-[12px] font-medium text-background transition-[opacity,scale] duration-[300ms,160ms] ease-out hover:opacity-90 active:scale-[0.97]"
              >
                {jump.label}
              </a>
              {action && (
                <Link
                  href={action.href}
                  className="w-fit rounded-md border border-panel-border px-6 py-3 text-[12px] font-medium text-muted-foreground transition-[color,border-color,scale] duration-[300ms,300ms,160ms] ease-out hover:border-accent/50 hover:text-foreground active:scale-[0.97]"
                >
                  {action.label}
                </Link>
              )}
            </div>
          </div>

          {aside && (
            <div className="col-start-7 hidden md:col-span-6 md:block">{aside}</div>
          )}
        </Grid>
      </div>

      <Grid inset={false}>{children}</Grid>
    </section>
  );
}
