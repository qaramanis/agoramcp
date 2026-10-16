import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const admieSource = defineSource({
  id: "admie",
  country: "gr",
  meta,
  tools,
  // A daily file is published every morning, and only three days have
  // gone without one since 2011: a week with none is the registry failing.
  probe: {
    tool: "list_files",
    input: { fileType: "SystemRealizationSCADA" },
    expect: {
      field: "count",
      atLeast: 1,
      detail: "It listed no system realisation file for the last seven days, where one is published every morning: it is up, and returning nothing.",
    },
  },
  // No `warm`: the file-type vocabulary is one 58 KB request, and files are
  // read on demand and kept for a day once read.
});

export default admieSource;
