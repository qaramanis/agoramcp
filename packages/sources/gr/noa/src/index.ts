import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const noaSource = defineSource({
  id: "noa",
  country: "gr",
  meta,
  tools,
  // The last day with nothing filtered: in the Institute's own record the
  // quietest 24 hours since 2018 still held ten events, so an empty answer
  // is the catalogue failing quietly, as it did on 28 September 2026.
  probe: {
    tool: "list_recent_earthquakes",
    input: {},
    expect: {
      field: "count",
      atLeast: 1,
      detail: "It answered with no earthquakes for the last 24 hours, where the catalogue has held at least ten every day since 2018: it is up, and returning nothing.",
    },
  },
  // No `warm`: there is no catalogue to pull down, and the one thing worth
  // holding — the last day of events — goes stale in minutes, so prefetching
  // it at boot would spend a request on an answer nobody reads.
});

export default noaSource;
