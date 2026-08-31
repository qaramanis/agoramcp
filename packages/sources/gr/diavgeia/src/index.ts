import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const diavgeiaSource = defineSource({
  id: "diavgeia",
  country: "gr",
  meta,
  tools,
});

export default diavgeiaSource;
