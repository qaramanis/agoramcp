import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const admieSource = defineSource({
  id: "admie",
  country: "gr",
  meta,
  tools,
  // No `warm`: the file-type vocabulary is one 58 KB request, and files are
  // read on demand and kept for a day once read.
});

export default admieSource;
