import type { Metadata } from "next";
import { Grid, gutterClass } from "@/components/layout/grid";
import RequestForm from "@/components/request/request-form";
import SupportedCountries from "@/components/request/supported-countries";
import { loadCatalogue } from "@/data/catalogue";
import { supportedCountries } from "@/data/requests";

export const metadata: Metadata = {
  title: "Request a country — agoramcp",
  description: "Tell us which country's open data should be mounted next.",
};

/** Per request, for the same reason as `/live`: the served list is the server's. */
export const revalidate = 0;

export default async function RequestPage() {
  const catalogue = await loadCatalogue();
  // The catalogue keys countries in lower case; ISO 3166-1 is upper.
  const mounted = catalogue.countries.map((country) => country.code.toUpperCase());

  return (
    // Centres the whole block — copy, form and list together — in the
    // viewport, rather than centring the copy and letting the form sit under
    // it. Spacing inside the block is untouched; only where the group sits
    // changes. `pt-28` still clears the fixed navigation.
    <main
      className={`flex min-h-screen flex-col justify-center pt-28 pb-20 ${gutterClass}`}
    >
      <Grid inset={false} className="w-full">
        <header className="col-span-12 col-start-1 mb-8 md:col-span-6">
          <p className="text-[10px] tracking-[0.3em] text-accent uppercase">
            Request a country
          </p>
          <h1 className="mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
            Your country, next.
          </h1>
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            agoramcp starts at its birthplace, Greece. Tell us where it should
            go next. The most asked-for ones get built first.
          </p>
        </header>

        <div className="col-span-12 col-start-1 md:col-span-6">
          <RequestForm mounted={mounted} />
        </div>

        {/* All twelve: the list it opens deals itself across them. */}
        <div className="col-span-12 col-start-1">
          <SupportedCountries countries={supportedCountries(mounted)} />
        </div>
      </Grid>
    </main>
  );
}
