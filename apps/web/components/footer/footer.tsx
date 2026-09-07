import Link from "next/link";
import { contactLinks, footerColumns, type FooterLink } from "@/data/footer";
import { Grid, gutterClass } from "@/components/layout/grid";
import { currentVersion } from "@/data/version";

function LinkList({ links }: { links: FooterLink[] }) {
  return (
    <ul className="m-0 list-none space-y-2 p-0">
      {links.map((link) => (
        <li key={link.href + link.label}>
          <Link
            href={link.href}
            {...(link.external && {
              target: "_blank",
              rel: "noopener noreferrer",
            })}
            className="text-[13px] text-background/60 transition-colors hover:text-background"
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Sticky at the bottom of the viewport so the page scrolls off it — the last
 * section slides away and the footer is already there underneath.
 *
 * The version is the newest commit's, read through `data/version.ts` — the
 * same call the changelog page opens with, so the two always agree. Before the
 * first `pnpm db:changelog` there is none, and the slot is left out rather
 * than filled with a guess.
 */
export default function Footer() {
  const version = currentVersion();

  return (
    <footer
      className={`sticky bottom-0 flex w-full flex-col justify-end overflow-hidden bg-foreground pt-12 pb-4 text-background ${gutterClass}`}
    >
      {/* Wordmark. The gradient sweeps the accent across the letters slowly
          enough to read as a sheen rather than an animation. */}
      <div className="mb-8 w-full overflow-hidden text-start md:mb-16">
        <span
          className="bg-clip-text text-[8vw] leading-none font-bold tracking-tight whitespace-nowrap text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(to right, #0a0a0a, #4ade80, #0a0a0a, #4ade80, #0a0a0a, #4ade80, #0a0a0a)",
            backgroundSize: "200% 100%",
            animation: "gradientPulse 20s ease-in-out infinite",
          }}
        >
          AGORA.MCP
        </span>
      </div>

      <div className="relative mb-12">
        <Grid inset={false} className="gap-y-6">
          {footerColumns.map((column) => (
            <div
              key={column.title}
              className={`${column.className} flex flex-col`}
            >
              <h6 className="mb-4 text-[15px] font-medium tracking-tight text-background">
                {column.title}
              </h6>
              <LinkList links={column.links} />
            </div>
          ))}

          {/* Contact sits in columns 7–9 on desktop and drops to its
              own full-width row below md, where the grid is only two wide. */}
          <div className="col-span-12 col-start-1 flex flex-col md:col-span-3 md:col-start-7">
            <h6 className="mb-4 text-[15px] font-medium tracking-tight text-background">
              Contact
            </h6>
            <LinkList links={contactLinks} />
          </div>
        </Grid>
      </div>

      <div className="relative flex w-full flex-col items-center justify-between gap-4 pt-4 md:flex-row md:gap-0">
        <div className="text-[13px] text-background/40">
          &copy; {new Date().getFullYear()} AGORA.MCP
        </div>
        {version && (
          <div className="text-center text-[11px] text-background/40 md:text-left">
            {version}
          </div>
        )}
        <div className="text-center text-[11px] text-background/40 md:text-left">
          created by{" "}
          <Link
            href="https://qaramanis.com"
            target="_blank"
            rel="noopener"
            className="transition-all duration-300 ease-in-out hover:text-background"
          >
            qaramanis
          </Link>
        </div>
      </div>
    </footer>
  );
}
