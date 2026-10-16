import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { prefetch, tools } from "./tools.ts";

export const mitosSource = defineSource({
  id: "mitos",
  country: "gr",
  meta,
  tools,
  // A search over every procedure: the whole register, read live.
  probe: {
    tool: "search_procedures",
    input: { query: "ληξιαρχική πράξη γέννησης", limit: 1 },
    expect: { field: "total", atLeast: 1, detail: "It found no procedure for a birth certificate, which every registry of procedures holds." },
  },
  // The facet index is nine wiki pages and about eight seconds; the register
  // of bodies three API pages and under one. Fetched now, the first filtered
  // search and the first body lookup answer at once instead of paying for it.
  // `loadFacets` reads the procedure list on the way, so that lands too.
  async warm(context) {
    await prefetch(context);
  },
});

export default mitosSource;
