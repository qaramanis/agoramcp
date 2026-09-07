import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const viesSource = defineSource({
  id: "vies",
  country: "gr",
  meta,
  tools,
  // No `warm`: both tools are one small request each, and there is no register
  // to pull down — VIES answers a question rather than serving a catalogue.
});

export default viesSource;
