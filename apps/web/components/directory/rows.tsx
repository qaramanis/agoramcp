import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CatalogueCountry, CatalogueSource } from "@/data/directory";
import { count } from "@/data/format";

/**
 * One row per country or source, in the lists on `/all` and on a country's
 * page. A title that takes the accent on hover, a line under it, and the
 * counts pushed to the right edge — the nav's panel rows, laid on the page.
 */

const rowClass =
  "group flex flex-col gap-2 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6";

const titleClass =
  "flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 group-hover:text-accent";

const lineClass = "mt-1 text-[12px] leading-relaxed text-muted-foreground";

const metaClass = "flex shrink-0 flex-wrap gap-x-3 text-[11px] text-muted tabular-nums";

export function CountryRow({ country }: { country: CatalogueCountry }) {
  return (
    <li className="border-t border-panel-border/50">
      <Link href={country.href} className={rowClass}>
        <div className="min-w-0">
          <p className={titleClass}>
            {country.name}
            <ArrowUpRight size={12} className="shrink-0" />
          </p>
          <p className={lineClass}>
            {country.sources.map((source) => source.name).join(", ")}
          </p>
        </div>
        <p className={metaClass}>
          <span className="uppercase">{country.code}</span>
          <span>{count(country.sources.length, "source")}</span>
          <span>{count(country.toolCount, "tool")}</span>
        </p>
      </Link>
    </li>
  );
}

export function SourceRow({
  source,
  showCountry = true,
}: {
  source: CatalogueSource;
  /** Off on a country's own page, where every row is that country's. */
  showCountry?: boolean;
}) {
  return (
    <li className="border-t border-panel-border/50">
      <Link href={source.href} className={rowClass}>
        <div className="min-w-0">
          <p className={titleClass}>
            {source.name}
            <ArrowUpRight size={12} className="shrink-0" />
          </p>
          <p className={lineClass}>{source.summary}</p>
        </div>
        <p className={metaClass}>
          {showCountry && <span>{source.countryName}</span>}
          <span>{count(source.toolCount, "tool")}</span>
          <span>{source.license}</span>
        </p>
      </Link>
    </li>
  );
}
