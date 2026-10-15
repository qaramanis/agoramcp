"use client";

import { useActionState, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { requestCountry, type RequestState } from "@/app/country/actions";
import Select from "@/components/playground/select";
import type { Country } from "@/db/queries";

const IDLE: RequestState = { kind: "idle" };

/**
 * One choice and one button. The selector is the playground's — the same
 * search-as-you-type field, which is what makes a list of 249 countries
 * usable without a scroll.
 *
 * The form posts to a Server Function; the selected code rides in a hidden
 * field because the selector is not a native `<select>`.
 */
export default function RequestForm({
  countries,
  unavailable,
}: {
  countries: Country[];
  /** Why the list is empty, when it is. Disables the form. */
  unavailable: string | null;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [state, submit, pending] = useActionState(requestCountry, IDLE);

  const country = countries.find((item) => item.code === code) ?? null;

  // Nothing to send without a country, and nothing to ask for one already served.
  const disabled =
    unavailable !== null || !country || country.supported || pending;

  return (
    <form
      action={submit}
      className="rounded-md border border-panel-border bg-panel p-3"
    >
      <input type="hidden" name="code" value={code ?? ""} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Select
            label="Country"
            value={code}
            placeholder="Select a country"
            onChange={setCode}
            options={countries.map((item) => ({
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
              pending ? "animate-spin opacity-100" : "opacity-0"
            }`}
          />

          <button
            type="submit"
            disabled={disabled}
            aria-busy={pending}
            className="flex h-8 grow cursor-pointer items-center justify-center rounded border border-accent/40 bg-accent/20 px-4 text-center text-[10px] font-bold tracking-wider text-accent uppercase transition-[background-color,opacity,scale] duration-[300ms,300ms,160ms] ease-out hover:bg-accent/30 enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 sm:grow-0"
          >
            Send request
          </button>
        </div>
      </div>

      <div className="mt-3 border-t border-panel-border/70 pt-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {unavailable ? (
            <span className="text-muted">{unavailable}</span>
          ) : country ? (
            <Standing country={country} state={state} />
          ) : (
            <span className="text-muted">Please select a country first</span>
          )}
        </p>
      </div>
    </form>
  );
}

/**
 * Where the country stands. The Server Function's answer takes over the line
 * while it is about the selected country; picking another one goes back to
 * the standing the page loaded.
 */
function Standing({
  country,
  state,
}: {
  country: Country;
  state: RequestState;
}): ReactNode {
  // The name carries the accent, so the line says which country it is about
  // before it is read.
  const name = <span className="text-accent">{country.name}</span>;

  if (state.kind !== "idle" && state.code === country.code) {
    switch (state.kind) {
      case "created":
        return (
          <>
            Thank you! {name} has now been requested {times(state.requests)}
          </>
        );
      case "duplicate":
        return (
          <>
            You have already asked for {name}; it has been requested{" "}
            {times(state.requests)}
          </>
        );
      case "supported":
        return <>{name} is already supported</>;
      case "unknown":
        return <>{name} is not a country a request can be filed for</>;
      case "error":
        return (
          <>The request for {name} could not be sent. Try again in a moment</>
        );
    }
  }

  if (country.supported) return <>{name} is already supported</>;
  if (country.requests === 0)
    return <>{name} has not been requested yet. Be the first!</>;
  return (
    <>
      {name} has been requested {times(country.requests)} this far
    </>
  );
}

function times(count: number): string {
  return `${count} ${count === 1 ? "time" : "times"}`;
}
