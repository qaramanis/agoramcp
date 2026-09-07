import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CatalogueCountry, CatalogueSource } from "@/data/directory";
import { count } from "@/data/format";

/**
 * One row, in the lists on `/all` and on a country's page. Two lines: the
 * name — taking the accent on hover — against the counts at the right edge,
 * and under them what the row holds. The nav's panel rows, laid on the page.
 *
 * A country and a source are the same row, so they are one component;
 * `CountryRow` and `SourceRow` under it are the two shapes' way in and hold no
 * markup of their own.
 */
export function Row({
  href,
  name,
  line,
  meta,
}: {
  href: string;
  name: string;
  /** The line under the name: what the row holds, in words. */
  line: ReactNode;
  /** The counts at the right edge. Anything null is left out. */
  meta: (string | null)[];
}) {
  return (
    <li className="border-t border-panel-border/50">
      <Link href={href} className="group block py-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="flex items-center gap-1 text-[15px] text-foreground transition-colors duration-300 group-hover:text-accent">
            {name}
            <ArrowUpRight size={13} className="shrink-0" />
          </p>
          {/* Its own flex child, so however long the line below runs the
              counts stay against the right edge. */}
          <p className="flex shrink-0 flex-wrap gap-x-3 text-[11px] text-muted tabular-nums">
            {meta.map((item) => item && <span key={item}>{item}</span>)}
          </p>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{line}</p>
      </Link>
    </li>
  );
}

export function CountryRow({ country }: { country: CatalogueCountry }) {
  return (
    <Row
      href={country.href}
      name={country.name}
      line={country.sources.map((source) => source.name).join(", ")}
      meta={[
        country.code.toUpperCase(),
        count(country.sources.length, "source"),
        count(country.toolCount, "tool"),
      ]}
    />
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
    <Row
      href={source.href}
      name={source.name}
      line={source.summary}
      meta={[
        showCountry ? source.countryName : null,
        count(source.toolCount, "tool"),
        source.license,
      ]}
    />
  );
}
