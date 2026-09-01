import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "ΜΗΤΟΣ",
  description:
    "The National Registry of Administrative Procedures (Εθνικό Μητρώο Διοικητικών Διαδικασιών «Μίτος»): every procedure a person or a business can ask the Greek state for — what it is, who provides it and where, which documents it needs, what it costs, the steps in person and on gov.gr, and the law behind it.",
  publisher: "Υπουργείο Ψηφιακής Διακυβέρνησης — ΕΔΥΤΕ Α.Ε. (GRNET)",
  upstreamUrl: "https://mitos.gov.gr",
  license: "CC-BY-SA-4.0",
  attribution: "Εθνικό Μητρώο Διοικητικών Διαδικασιών «Μίτος» (mitos.gov.gr)",
  docsUrl: "https://api.mitos.gov.gr/info/",
  ttl: {
    // The register is edited by hand: roughly eighty procedures a day change
    // in a busy month. An hour keeps a search honest without re-reading the
    // whole list on every call.
    default: 3_600,
    // One procedure's record costs upstream 1–13 s to assemble on a cold
    // read, and the guidance in it changes on the order of months — a stale
    // afternoon is a fair price for the record most callers open repeatedly.
    get_procedure: 21_600,
    // The facets are read off an index that is itself held for a day.
    list_life_events: 86_400,
    list_audiences: 86_400,
    // Bodies rename and merge on the order of years.
    search_organizations: 86_400,
    get_organization: 86_400,
  },
};
