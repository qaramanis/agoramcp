/**
 * What the request form knows about a country: whether it is already mounted,
 * and how many times it has been asked for.
 *
 * The counts are local placeholder data. They stand in for the table this will
 * read from once there is a database behind the form — nothing here is
 * persisted, and sending a request does not change them yet.
 *
 * Support is not listed here: it is read off the MCP server's own registry
 * (`data/catalogue.ts`), so a country stops being requestable the moment its
 * first source is mounted. The page loads the catalogue and passes the mounted
 * codes down; nothing here fetches.
 */
import { requestCountries, type RequestCountry } from "./countries";

/**
 * The countries with at least one source mounted, by name. Derived, never
 * listed: a country appears here the moment its first source does.
 *
 * `mounted` is ISO 3166-1 alpha-2 in upper case, as the request form keys it.
 */
export function supportedCountries(mounted: readonly string[]): RequestCountry[] {
  return requestCountries.filter((country) => mounted.includes(country.code));
}

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

export function countryStatus(code: string, mounted: readonly string[]): CountryStatus {
  if (mounted.includes(code.toUpperCase())) return { kind: "supported" };

  const count = requestCounts[code] ?? 0;
  return count > 0 ? { kind: "requested", count } : { kind: "unrequested" };
}
