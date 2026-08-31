/**
 * What the request form knows about a country: whether it is already mounted,
 * and how many times it has been asked for.
 *
 * The counts are local placeholder data. They stand in for the table this will
 * read from once there is a database behind the form — nothing here is
 * persisted, and sending a request does not change them yet.
 *
 * Support is not listed here: it is read off `data/playground.ts`, which is
 * already the catalogue of what is mounted, so a country stops being
 * requestable the moment its first source lands.
 */
import { countries as mountedCountries } from "./playground";
import type { RequestCountry } from "./countries";

/**
 * The countries with at least one source mounted, in catalogue order. Derived,
 * never listed: a country appears here the moment its first source does.
 */
export const supportedCountries: RequestCountry[] = mountedCountries.map((country) => ({
  code: country.code.toUpperCase(),
  name: country.name,
}));

/** Standing requests, keyed by ISO 3166-1 alpha-2. */
export const requestCounts: Record<string, number> = {
  CY: 34,
  IT: 21,
  BG: 18,
  ES: 15,
  PT: 11,
  RO: 9,
  DE: 8,
  FR: 7,
  RS: 6,
  AL: 5,
  MK: 4,
  NL: 3,
  IE: 2,
  BR: 1,
};

export type CountryStatus =
  /** Already mounted — there is nothing to request. */
  | { kind: "supported" }
  | { kind: "requested"; count: number }
  | { kind: "unrequested" };

export function countryStatus(code: string): CountryStatus {
  // The catalogue keys countries in lower case; ISO 3166-1 is upper.
  const mounted = mountedCountries.some(
    (country) => country.code.toLowerCase() === code.toLowerCase(),
  );
  if (mounted) return { kind: "supported" };

  const count = requestCounts[code] ?? 0;
  return count > 0 ? { kind: "requested", count } : { kind: "unrequested" };
}
