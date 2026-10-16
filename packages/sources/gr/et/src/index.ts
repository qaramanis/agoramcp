import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const etSource = defineSource({
  id: "et",
  country: "gr",
  meta,
  tools,
  // No `warm`: the index is searched upstream one bounded query at a time,
  // and there is no catalogue small enough to hold whole.
});

export default etSource;
