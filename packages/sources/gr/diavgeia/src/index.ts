import { defineSource } from "@agoramcp/core";
import { loadRegister } from "./client.ts";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const diavgeiaSource = defineSource({
  id: "diavgeia",
  country: "gr",
  meta,
  tools,
  // A closed month of a common subject: thousands of acts, never none.
  probe: {
    tool: "search_decisions",
    input: { subject: "προμήθεια", issuedFrom: "2026-01-01", issuedTo: "2026-01-31", size: 1 },
    expect: {
      field: "total",
      atLeast: 1,
      detail: "It found no procurement decision in January 2026, a month that holds thousands: the search is answering empty.",
    },
  },
  // The register of bodies is 2.7 MB and takes upstream ~19 s to produce.
  // Fetched now, the first name search and the first cold search page both
  // answer at once instead of paying for it.
  async warm(context) {
    await loadRegister(context.cache, context.signal);
  },
});

export default diavgeiaSource;
