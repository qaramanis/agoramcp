import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const ecbSource = defineSource({
  id: "ecb",
  country: "gr",
  meta,
  tools,
  // The latest dollar rate: one 3 KB series, set every working day.
  probe: {
    tool: "get_exchange_rate",
    input: { currencies: "USD" },
    expect: { field: "rates", atLeast: 1, detail: "It returned no dollar reference rate, which it sets every working day." },
  },
  // No `warm`: every structure the tools read is small and per flow, and the
  // one list worth holding — the dataflows — is a single 150 KB request.
});

export default ecbSource;
