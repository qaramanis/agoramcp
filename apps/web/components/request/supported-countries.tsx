"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Grid } from "@/components/layout/grid";
import { supportedCountries } from "@/data/requests";

/** Columns the list is dealt into, each two of the page's twelve. */
const COLUMNS = 4;

/**
 * The answer to "is mine already there?", one click away and closed by
 * default — the form is what the page is for, and the list is the footnote.
 *
 * The panel expands rather than appearing: the row it opens under does not
 * move, so nothing below it jumps.
 */
export default function SupportedCountries() {
  const [open, setOpen] = useState(false);

  const columns = deal(supportedCountries, COLUMNS);

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="supported-countries"
        onClick={() => setOpen((current) => !current)}
        className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground transition-colors duration-300 hover:text-foreground"
      >
        List of supported countries
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* A `0fr` → `1fr` row is the height animation without measuring
          anything: the content keeps its own natural height throughout. */}
      <div
        id="supported-countries"
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {/* `inset={false}`: the columns place themselves, and the grid's own
              inset rule would stack all four on column 2. */}
          <Grid inset={false} className="pt-3">
            {columns.map((column, index) => (
              <ul
                key={index}
                className="col-span-6 list-none sm:col-span-3 md:col-span-2"
              >
                {column.map((country) => (
                  <li key={country.code} className="py-1 text-[12px] text-foreground">
                    {country.name}
                  </li>
                ))}
              </ul>
            ))}
          </Grid>
        </div>
      </div>
    </div>
  );
}

/**
 * Down one column, then the next — so the list still reads in order once it is
 * split. Short lists leave the later columns empty rather than rebalancing.
 */
function deal<T>(items: T[], into: number): T[][] {
  const perColumn = Math.ceil(items.length / into);
  return Array.from({ length: into }, (_, index) =>
    items.slice(index * perColumn, (index + 1) * perColumn),
  );
}
