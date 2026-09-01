import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Where a page sits in the catalogue: the levels above it, then its own name. */
export default function Breadcrumb({
  trail,
  current,
}: {
  trail: { label: string; href: string }[];
  current: string;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        {trail.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1">
            <Link
              href={crumb.href}
              className="transition-colors duration-300 hover:text-foreground"
            >
              {crumb.label}
            </Link>
            <ChevronRight size={10} aria-hidden className="shrink-0" />
          </li>
        ))}
        <li aria-current="page" className="text-muted-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
}
