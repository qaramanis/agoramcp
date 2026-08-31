"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { requestCountries, type RequestCountry } from "@/data/countries";
import { countryStatus, type CountryStatus } from "@/data/requests";
import Select from "@/components/playground/select";

/**
 * One choice and one button. The selector is the playground's — the same
 * search-as-you-type field, which is what makes a list of 251 countries
 * usable without a scroll.
 *
 * Nothing is submitted yet: the button is deliberately inert until there is
 * somewhere to send a request to.
 */
export default function RequestForm() {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const country = requestCountries.find((item) => item.code === code) ?? null;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const send = () => {
    if (!country || busy) return;
    setBusy(true);
    // Stand-in for the submit. There is nothing to post to yet, so the state
    // clears itself instead of waiting on a response — replace the timer with
    // the request, not the spinner.
    timer.current = setTimeout(() => setBusy(false), 1400);
  };

  return (
    <div className="max-w-2xl rounded-md border border-panel-border bg-panel p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Select
            label="Country"
            value={code}
            placeholder="Select a country"
            onChange={setCode}
            options={requestCountries.map((item) => ({
              value: item.code,
              label: item.name,
            }))}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* The slot is always in the layout and only its contents fade, so a
              call starting cannot change the width of anything around it. */}
          <LoaderCircle
            size={14}
            aria-hidden
            className={`shrink-0 text-accent transition-opacity duration-300 ${
              busy ? "animate-spin opacity-100" : "opacity-0"
            }`}
          />

          {/* Disabled until there is a country to request, so the button never
              sends an empty one. */}
          <button
            type="button"
            onClick={send}
            disabled={!country || busy}
            aria-busy={busy}
            className="flex h-8 grow cursor-pointer items-center justify-center rounded border border-accent/40 bg-accent/20 px-4 text-center text-[10px] font-bold tracking-wider text-accent uppercase transition-all duration-300 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40 sm:grow-0"
          >
            Send request
          </button>
        </div>
      </div>

      <div className="mt-3 border-t border-panel-border/70 pt-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {country ? standing(country) : <span className="text-muted">Please select a country first</span>}
        </p>
      </div>
    </div>
  );
}

/**
 * Where the country stands today. Read from local placeholder data for now —
 * the sentence is the same either way once the counts come from a database.
 */
function standing(country: RequestCountry): ReactNode {
  return (
    <>
      {/* The name carries the accent, so the line says which country it is
          about before it is read. */}
      <span className="text-accent">{country.name}</span>{" "}
      {standingTail(countryStatus(country.code))}
    </>
  );
}

/** The sentence after the name — the only part the status changes. */
function standingTail(status: CountryStatus): string {
  if (status.kind === "supported") return "is already supported";
  if (status.kind === "unrequested") return "has not been requested yet. Be the first!";

  const times = status.count === 1 ? "time" : "times";
  return `has already been requested ${status.count} ${times}`;
}
