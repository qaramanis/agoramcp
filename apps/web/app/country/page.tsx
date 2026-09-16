import type { Metadata } from "next";
import { Grid, gutterClass } from "@/components/layout/grid";
import RequestForm from "@/components/request/request-form";
import { loadCountries } from "@/db/queries";

export const metadata: Metadata = {
  title: "Request a country - agoramcp",
  description: "Tell us which country's open data should be mounted next.",
};

/** Per request: the counts are the database's, and a request changes them. */
export const revalidate = 0;

export default async function RequestPage() {
  const { countries, unavailable } = await loadCountries();

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The `/mcp` hero band: one stack on the left five columns, centred in
          a band tall enough to stand on its own. The selector sits where the
          CTA sits over there — same column, same distance under the copy.
          `inset={false}` because the column start is declared here. */}
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full">
          <div className="col-span-12 col-start-1 md:col-span-5">
            {/*<p className="text-[10px] tracking-[0.3em] text-accent uppercase">
              Request a country
            </p>*/}
            <h1 className="mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Your country, next.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              agoramcp starts at its birthplace, Greece. Tell us where it should
              go next. The most asked-for ones get built first.
            </p>

            <div className="mt-6">
              <RequestForm countries={countries} unavailable={unavailable} />
            </div>
          </div>
        </Grid>
      </header>
    </main>
  );
}
