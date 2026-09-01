import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Grid } from "@/components/layout/grid";

/**
 * The registry could not be read, so the page cannot say whether what was
 * asked for exists. It says that, rather than a 404 it cannot stand behind.
 */
export default function Unavailable({ message }: { message: string }) {
  return (
    <Grid inset={false}>
      <div className="col-span-12 col-start-1 md:col-span-6">
        <h1 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
          The catalogue is unavailable.
        </h1>
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">{message}</p>
        <Link
          href="/all"
          className="group mt-6 flex w-fit items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
        >
          Back to all sources
          <ArrowUpRight size={12} className="shrink-0" />
        </Link>
      </div>
    </Grid>
  );
}
