import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "data.gov.gr",
  description:
    "The national open-data catalogue: 22,000+ datasets from 370 ministries, regions, municipalities and agencies — geospatial layers, statistics, registers, budgets, measurements — each with its publisher, licence and files, and the rows of the tabular ones queryable in place.",
  publisher: "Υπουργείο Ψηφιακής Διακυβέρνησης — Εθνικός Κατάλογος Ανοικτών Δεδομένων (data.gov.gr)",
  upstreamUrl: "https://data.gov.gr",
  // A catalogue has no one licence. Each dataset carries its own — CC-BY,
  // ODbL, CC-BY-SA, "other (open)", "other (non-commercial)", or none
  // recorded — and every result here names it. What is stated here is the
  // portal's own framework, not a grant that covers the data.
  license: "Per dataset (ν. 4305/2014 open-data framework; see `licence` on every result)",
  attribution: "data.gov.gr και ο φορέας που δημοσιεύει το κάθε σύνολο δεδομένων (named on every result)",
  docsUrl: "https://docs.ckan.org/en/2.10/api/",
  ttl: {
    // The catalogue changes as bodies publish; an hour is fine for a search.
    default: 3_600,
    // A dataset's record changes when its publisher edits it — rarely.
    get_dataset: 21_600,
    // Files are re-uploaded, not edited in place; the datastore follows.
    query_resource: 3_600,
    read_resource: 21_600,
    // Bodies, tags and vocabularies move on the order of months.
    list_organizations: 86_400,
    list_tags: 86_400,
    list_facets: 86_400,
  },
};
