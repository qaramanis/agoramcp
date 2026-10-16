import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const fuelpricesSource = defineSource({
  id: "fuelprices",
  country: "gr",
  meta,
  tools,
  // The weekly listing is a quarter of the daily one's 530 KB, and as live.
  probe: {
    tool: "list_bulletins",
    input: { type: "weekly", limit: 1 },
    expect: { field: "count", atLeast: 1, detail: "It listed no weekly bulletin at all, where it holds one a week since 2012." },
  },
  // No `warm`: the listing a first call needs is one request, and the
  // bulletins are read on demand and kept for a week once read.
});

export default fuelpricesSource;
