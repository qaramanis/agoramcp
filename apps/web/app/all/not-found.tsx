import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Grid, gutterClass } from "@/components/layout/grid";

/**
 * A country or source address the registry has nothing for. Scoped to the
 * catalogue: the rest of the site still falls through to the framework's own.
 */
export default function NotFound() {
  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <Grid inset={false}>
        <div className="col-span-12 col-start-1 md:col-span-6">
          <h1 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
            Not in the catalogue.
          </h1>
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            No country or source answers at this address. It may have moved, or
            it may not be mounted yet.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/all"
              className="group flex w-fit items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
            >
              Browse every source
              <ArrowUpRight size={12} className="shrink-0" />
            </Link>
            <Link
              href="/country"
              className="group flex w-fit items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
            >
              Request a country
              <ArrowUpRight size={12} className="shrink-0" />
            </Link>
          </div>
        </div>
      </Grid>
    </main>
  );
}
