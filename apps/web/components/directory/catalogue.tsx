"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { Grid } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import type { CatalogueCountry, CatalogueSource } from "@/data/directory";
import { count } from "@/data/format";
import { CountryRow, SourceRow } from "./rows";
import SectionHero from "./section-hero";

/**
 * The catalogue: a hero whose right column is the search field, and under it
 * the two lists that narrow as you type. A country matches on its name or
 * code, or because one of its sources does; a source on its name, id,
 * publisher, summary or country — so typing a country's name shows its
 * sources, and typing a source's shows the country that has it.
 *
 * The copy on the left is handed in from the page so it stays server-rendered;
 * the search field lives here because it drives the lists below, and the two
 * have to share one piece of state.
 */
export default function Catalogue({
  header,
  countries,
  unavailable,
}: {
  /** The hero copy — title and subtext — rendered by the server page. */
  header: ReactNode;
  countries: CatalogueCountry[];
  /** Why the lists are empty, when they are. */
  unavailable: string | null;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const matchedCountries = countries.filter((country) => countryMatches(country, needle));
  const matchedSources = countries
    .flatMap((country) => country.sources)
    .filter((source) => sourceMatches(source, needle))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  const searching = needle.length > 0;
  const nothing = searching && matchedCountries.length === 0 && matchedSources.length === 0;

  /* Built once: the same rows stand under the section's hero and, while a
     search is running, under the plain heading that replaces it. */
  const countryRows = matchedCountries.map((country) => (
    <CountryRow key={country.code} country={country} />
  ));
  const sourceRows = matchedSources.map((source) => (
    <SourceRow key={`${source.country}/${source.id}`} source={source} />
  ));

  const totalSources = countries.reduce((total, country) => total + country.sources.length, 0);
  const totalTools = countries.reduce((total, country) => total + country.toolCount, 0);

  return (
    <>
      {/* The /mcp and /api hero shape: copy on the left five columns, the
          thing itself on the right six. Here the thing is the search. */}
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">{header}</div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            {/* The playground selector's search header, as a field of its own. */}
            <label className="flex h-11 items-center gap-2 rounded-md border border-panel-border bg-panel px-3 transition-colors duration-300 focus-within:border-accent/50">
              <Search size={14} className="shrink-0 text-muted" />
              <input
                type="text"
                value={query}
                placeholder="Search for a country or a source"
                aria-label="Search the catalogue"
                spellCheck={false}
                autoComplete="off"
                disabled={unavailable !== null}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("");
                }}
                className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed"
              />
              {needle.length > 0 && !nothing && (
                <span className="shrink-0 text-[11px] text-muted tabular-nums">
                  {count(matchedSources.length, "source")}
                </span>
              )}
            </label>

            {unavailable ? (
              <p className="mt-3 text-[12px] leading-relaxed text-muted">{unavailable}</p>
            ) : (
              <p className="mt-3 text-[11px] text-muted tabular-nums">
                {count(countries.length, "country")} · {count(totalSources, "source")} ·{" "}
                {count(totalTools, "tool")}
              </p>
            )}
          </div>
        </Grid>
      </header>

      {nothing ? (
        <NothingFound query={query.trim()} />
      ) : (
        <>
          {/* The hero is for the reader who arrived at the catalogue; the
              reader who is typing wants the rows, not a screen of copy in
              front of them, so a search swaps it for the plain heading. */}
          {searching ? (
            <Band ariaLabel="Countries" title="Countries">
              <ul className="col-span-8 col-start-1 mt-8 border-b border-panel-border/50">
                {countryRows}
              </ul>
              {matchedCountries.length === 0 && !unavailable && (
                <Empty>No country matches “{query.trim()}”.</Empty>
              )}
            </Band>
          ) : (
            <SectionHero
              label="Countries"
              title="One server per country."
              blurb="Each country bundles the registries it publishes behind a single MCP endpoint. Open one to see the sources it serves."
              jump={{ href: "#countries", label: "View countries" }}
              action={{ href: "/country", label: "Request a country" }}
            >
              {/* The jump lands on the heading rather than the first row, so
                  the list arrives with its name above it. `scroll-mt-28`
                  clears the fixed navigation. */}
              <h3
                id="countries"
                className="col-span-12 col-start-1 scroll-mt-28 text-[1.5rem] leading-[1.25] font-medium tracking-tight text-foreground md:col-span-8"
              >
                Supported countries
              </h3>
              <ul className="col-span-12 col-start-1 mt-8 border-b border-panel-border/50 md:col-span-8">
                {countryRows}
              </ul>
            </SectionHero>
          )}

          {searching ? (
            <Band ariaLabel="Sources" title="Sources">
              <ul className="col-span-8 col-start-1 mt-8 border-b border-panel-border/50">
                {sourceRows}
              </ul>
              {matchedSources.length === 0 && !unavailable && (
                <Empty>No source matches “{query.trim()}”.</Empty>
              )}
            </Band>
          ) : (
            /* No second call: a source is not something a reader can ask for
               the way a country is — the list itself is where they go next. */
            <SectionHero
              label="Sources"
              title="Every registry, on its own endpoint."
              blurb="A source is one official registry, mounted whole. Open one for its address, its licence and the full reference of its tools."
              jump={{ href: "#sources", label: "View sources" }}
            >
              <h3
                id="sources"
                className="col-span-12 col-start-1 scroll-mt-28 text-[1.5rem] leading-[1.25] font-medium tracking-tight text-foreground md:col-span-8"
              >
                Supported sources
              </h3>
              <ul className="col-span-12 col-start-1 mt-8 border-b border-panel-border/50 md:col-span-8">
                {sourceRows}
              </ul>
            </SectionHero>
          )}
        </>
      )}
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="col-span-8 col-start-1 mt-4 text-[12px] leading-relaxed text-muted">
      {children}
    </p>
  );
}

/**
 * Neither list has anything for the query. The likeliest reason is a country
 * agoramcp does not serve yet, and there is a page for asking.
 */
function NothingFound({ query }: { query: string }) {
  return (
    <Band ariaLabel="Nothing found" title={`Nothing matches “${query}”.`}>
      <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
        No country or source by that name is mounted yet. If it is a country,
        ask for it — the most asked-for ones get built first.
      </p>
      <Link
        href="/country"
        className="group col-span-8 col-start-1 mt-6 flex w-fit items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
      >
        Request a country
        <ArrowUpRight size={12} className="shrink-0" />
      </Link>
    </Band>
  );
}

function countryMatches(country: CatalogueCountry, needle: string): boolean {
  if (needle.length === 0) return true;
  return (
    has(country.name, needle) ||
    has(country.code, needle) ||
    country.sources.some((source) => sourceMatches(source, needle))
  );
}

function sourceMatches(source: CatalogueSource, needle: string): boolean {
  if (needle.length === 0) return true;
  return (
    has(source.name, needle) ||
    has(source.id, needle) ||
    has(source.publisher, needle) ||
    has(source.summary, needle) ||
    has(source.countryName, needle) ||
    has(source.country, needle)
  );
}

function has(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}
