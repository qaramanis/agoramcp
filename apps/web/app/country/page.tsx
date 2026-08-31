import type { Metadata } from "next";
import { gutterClass } from "@/components/layout/grid";
import RequestForm from "@/components/request/request-form";
import SupportedCountries from "@/components/request/supported-countries";

export const metadata: Metadata = {
  title: "Request a country — agoramcp",
  description: "Tell us which country's open data should be mounted next.",
};

export default function RequestPage() {
  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="mb-8 max-w-2xl">
        <p className="text-[10px] tracking-[0.3em] text-accent uppercase">
          Request a country
        </p>
        <h1 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
          Your country, next.
        </h1>
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          agoramcp starts at its birthplace, Greece. Tell us where it should go
          next. The most asked-for ones get built first.
        </p>
      </header>

      <RequestForm />
      <SupportedCountries />
    </main>
  );
}
