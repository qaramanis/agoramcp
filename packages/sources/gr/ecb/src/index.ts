import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const ecbSource = defineSource({
  id: "ecb",
  country: "gr",
  meta,
  tools,
  // No `warm`: every structure the tools read is small and per flow, and the
  // one list worth holding — the dataflows — is a single 150 KB request.
});

export default ecbSource;
