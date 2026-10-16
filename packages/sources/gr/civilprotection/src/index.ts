import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const civilprotectionSource = defineSource({
  id: "civilprotection",
  country: "gr",
  meta,
  tools,
  // The archive lists maps all year, the last season's outside it.
  probe: {
    tool: "list_maps",
    input: { limit: 1 },
    expect: {
      field: "count",
      atLeast: 1,
      detail: "Its archive listed no fire-risk map at all, where it holds every map since 2005.",
    },
  },
  // No `warm`: a map is one 300 KB image read on demand, and what is kept is
  // its categories, not the image.
});

export default civilprotectionSource;
