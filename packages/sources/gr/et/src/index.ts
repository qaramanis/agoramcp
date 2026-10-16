import { defineSource } from "@agoramcp/core";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const etSource = defineSource({
  id: "et",
  country: "gr",
  meta,
  tools,
  // One law by its number and year: a 2 KB answer that cannot be empty.
  probe: {
    tool: "search_legislation",
    input: { kind: "law", number: "4990", year: 2022 },
    expect: { field: "total", atLeast: 1, detail: "Its law index no longer found ν. 4990/2022: the search is answering empty." },
  },
  // No `warm`: the index is searched upstream one bounded query at a time,
  // and there is no catalogue small enough to hold whole.
});

export default etSource;
