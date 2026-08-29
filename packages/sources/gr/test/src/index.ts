import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const testSource = defineSource({
  id: "test",
  country: "gr",
  meta,
  tools,
});

export default testSource;
