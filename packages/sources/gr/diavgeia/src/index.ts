import { defineSource } from "@agoramcp/core";
import { loadRegister } from "./client.ts";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const diavgeiaSource = defineSource({
  id: "diavgeia",
  country: "gr",
  meta,
  tools,
  // The register of bodies is 2.7 MB and takes upstream ~19 s to produce.
  // Fetched now, the first name search and the first cold search page both
  // answer at once instead of paying for it.
  async warm(context) {
    await loadRegister(context.cache, context.signal);
  },
});

export default diavgeiaSource;
