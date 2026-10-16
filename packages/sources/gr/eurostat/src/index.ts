import { defineSource } from "@agoramcp/core";
import { fetchCatalogue } from "./client.ts";
import { meta } from "./meta.ts";
import { tools } from "./tools.ts";

export const eurostatSource = defineSource({
  id: "eurostat",
  country: "gr",
  meta,
  tools,
  // A dataset's structure: 5 KB, read live where the search answers from
  // a catalogue held for hours.
  probe: {
    tool: "get_dataset_structure",
    input: { dataset: "une_rt_m" },
    expect: { field: "dimensions", atLeast: 3, detail: "It described monthly unemployment with no dimensions, which it has always had." },
  },
  // The table of contents is 2 MB and takes 4–8 s to arrive; search_datasets
  // answers from it locally, so its first caller should not be the one to wait.
  async warm(context) {
    await fetchCatalogue(context.cache, context.signal);
  },
});

export default eurostatSource;
