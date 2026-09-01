import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Δήμος Αθηναίων",
  description:
    "The City of Athens open-data portal: 460+ datasets on the city itself — daily visitor counts from the Smart Neighbourhood WiFi network, parks and green space, street furniture and GIS layers, traffic and municipal services — with the tabular ones queryable in place.",
  publisher: "Δήμος Αθηναίων — Πύλη Ανοικτών Δεδομένων (opendata.cityofathens.gr)",
  upstreamUrl: "https://opendata.cityofathens.gr",
  // No dataset on the portal records a licence and the portal's own pages
  // state none. What is written here is the fact, not a grant: every result
  // carries `licence` as "not specified", and reuse terms are the city's to
  // give. Ask the publisher named on the dataset before redistributing.
  license: "Not stated — no dataset records a licence (see `licence` on every result)",
  attribution: "Δήμος Αθηναίων (opendata.cityofathens.gr) και η υπηρεσία που δημοσιεύει το κάθε σύνολο δεδομένων",
  docsUrl: "https://docs.ckan.org/en/2.11/api/",
  ttl: {
    // The WiFi counts land daily; an hour keeps a search honest.
    default: 3_600,
    get_dataset: 21_600,
    query_resource: 3_600,
    read_resource: 21_600,
    list_organizations: 86_400,
    list_tags: 86_400,
    list_facets: 86_400,
  },
};
