import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const civilprotectionSource = defineSource({
  id: "civilprotection",
  country: "gr",
  meta,
  tools,
  // No `warm`: a map is one 300 KB image read on demand, and what is kept is
  // its categories, not the image.
});

export default civilprotectionSource;
