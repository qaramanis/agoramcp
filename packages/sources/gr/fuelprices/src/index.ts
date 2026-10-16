import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const fuelpricesSource = defineSource({
  id: "fuelprices",
  country: "gr",
  meta,
  tools,
  // No `warm`: the listing a first call needs is one request, and the
  // bulletins are read on demand and kept for a week once read.
});

export default fuelpricesSource;
