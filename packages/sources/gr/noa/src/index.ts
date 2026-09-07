import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const noaSource = defineSource({
  id: "noa",
  country: "gr",
  meta,
  tools,
  // No `warm`: there is no catalogue to pull down, and the one thing worth
  // holding — the last day of events — goes stale in minutes, so prefetching
  // it at boot would spend a request on an answer nobody reads.
});

export default noaSource;
