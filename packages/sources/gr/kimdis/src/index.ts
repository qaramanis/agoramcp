import { defineSource } from "@agoramcp/core";
import { loadRegister } from "./client.ts";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const kimdisSource = defineSource({
  id: "kimdis",
  country: "gr",
  meta,
  tools,
  // A closed month of a common CPV: an answer that cannot be empty.
  probe: {
    tool: "search_contracts",
    input: { cpv: "33600000-6", submittedFrom: "2026-08-01", submittedTo: "2026-08-31" },
    expect: { field: "total", atLeast: 1, detail: "It found no contract for pharmaceuticals in August 2026, a month that holds hundreds." },
  },
  // The register of bodies is Διαύγεια's: 2.7 MB and ~19 s to produce.
  // Fetched now, the first name search answers at once instead of paying for it.
  async warm(context) {
    await loadRegister(context.cache, context.signal);
  },
});

export default kimdisSource;
