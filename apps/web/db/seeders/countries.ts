import type { Sql } from "../client";
import { requestCountries } from "../../data/countries";

/**
 * Countries with a source mounted. Shipping one is: add its code here, run
 * `pnpm db:seed countries`. The seeder only ever sets the flag — taking a
 * country off is a deliberate `update`, never a side effect of a re-seed.
 */
const SUPPORTED = ["GR"];

/**
 * The full ISO 3166-1 list from `data/countries.ts`, upserted: a re-run adds
 * anything new, refreshes a name that changed, and touches nothing else —
 * requests reference these rows by code, and `supported` stays as it is.
 */
export async function seed(sql: Sql): Promise<string> {
  await sql`
    insert into countries ${sql(requestCountries, "code", "name")}
    on conflict (code) do update
      set name = excluded.name, updated_at = now()
      where countries.name is distinct from excluded.name`;

  const flagged = await sql`
    update countries
    set supported = true, updated_at = now()
    where code in ${sql(SUPPORTED)} and not supported`;

  return `${requestCountries.length} countries upserted, ${flagged.count} newly marked supported`;
}
