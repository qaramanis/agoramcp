import { defineSource } from "@agoramcp/core";
import { loadRegister } from "./client.ts";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const kimdisSource = defineSource({
  id: "kimdis",
  country: "gr",
  meta,
  tools,
  // The register of bodies is Διαύγεια's: 2.7 MB and ~19 s to produce.
  // Fetched now, the first name search answers at once instead of paying for it.
  async warm(context) {
    await loadRegister(context.cache, context.signal);
  },
});

export default kimdisSource;
