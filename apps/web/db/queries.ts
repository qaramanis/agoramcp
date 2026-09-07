import { db } from "./client";

/** A country as the request page sees it. */
export type Country = {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  name: string;
  supported: boolean;
  /** Distinct requesters so far. */
  requests: number;
};

/** Every country with its standing, alphabetical as a reader sees it. */
export async function listCountries(): Promise<Country[]> {
  const sql = db();
  const rows = await sql<Country[]>`
    select c.code, c.name, c.supported, count(r.id)::int as requests
    from countries c
    left join requests r on r.country_code = c.code
    group by c.code`;

  // Sorted here rather than by the database so that accents and case fall
  // where `data/countries.ts` puts them, not where the server's collation does.
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export type CountriesResult = {
  countries: Country[];
  /** Why the list is empty, when it is empty for a reason worth showing. */
  unavailable: string | null;
};

/** The page's read: a database that cannot be reached is a message, not a crash. */
export async function loadCountries(): Promise<CountriesResult> {
  try {
    return { countries: await listCountries(), unavailable: null };
  } catch (error) {
    console.error("countries: database unavailable", error);
    return { countries: [], unavailable: "The request list could not be reached." };
  }
}

export type RequestOutcome =
  | { kind: "created" | "duplicate"; requests: number }
  | { kind: "supported" }
  | { kind: "unknown" };

/**
 * Files a request. The unique pair on `requests` is the whole dedup: an
 * insert that conflicts is the same person asking again, and is reported as
 * such rather than as an error. A supported country is refused before the
 * insert — the form does not offer the button for one, but a field is a
 * string and a string can say anything.
 */
export async function createRequest(code: string, requesterHash: string): Promise<RequestOutcome> {
  const sql = db();

  const [country] = await sql<{ supported: boolean }[]>`
    select supported from countries where code = ${code}`;
  if (!country) return { kind: "unknown" };
  if (country.supported) return { kind: "supported" };

  const inserted = await sql`
    insert into requests (country_code, requester_hash)
    values (${code}, ${requesterHash})
    on conflict (country_code, requester_hash) do nothing
    returning id`;

  const [count] = await sql<{ requests: number }[]>`
    select count(*)::int as requests from requests where country_code = ${code}`;

  return { kind: inserted.length > 0 ? "created" : "duplicate", requests: count?.requests ?? 0 };
}
