import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const viesSource = defineSource({
  id: "vies",
  country: "gr",
  meta,
  tools,
  // Which member states answer: VIES's own cheapest question.
  probe: {
    tool: "list_member_states",
    input: {},
    expect: { field: "memberStates", atLeast: 27, detail: "It listed fewer than the 27 member states it always reports on." },
  },
  // No `warm`: both tools are one small request each, and there is no register
  // to pull down — VIES answers a question rather than serving a catalogue.
});

export default viesSource;
