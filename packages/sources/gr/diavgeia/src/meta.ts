import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Διαύγεια",
  description:
    "Every administrative act the Greek state publishes under the Transparency Programme (ν. 4305/2014): appointments, expenditure, contract awards and regulatory decisions, each carrying a unique ΑΔΑ and a signed PDF.",
  publisher: "Υπουργείο Ψηφιακής Διακυβέρνησης — Πρόγραμμα ΔΙΑΥΓΕΙΑ",
  upstreamUrl: "https://diavgeia.gov.gr/opendata",
  license: "CC-BY-4.0",
  attribution: "Πρόγραμμα ΔΙΑΥΓΕΙΑ (diavgeia.gov.gr)",
  docsUrl: "https://diavgeia.gov.gr/api/help",
  ttl: {
    // Roughly 12,000 new acts are published each day, so a short window keeps
    // "what was posted today" honest without hammering the index.
    default: 300,
    // An act changes only when its body corrects or revokes it, which is rare
    // and never urgent; an hour of staleness is a fair price for the record
    // most callers fetch repeatedly. `get_decision_history` is the fresh view.
    get_decision: 3_600,
    // The PDF is immutable for a given version; the extracted text with it.
    get_decision_text: 3_600,
    // The controlled vocabularies change when the law does — i.e. rarely.
    list_decision_types: 86_400,
    get_decision_type: 86_400,
    list_thematic_categories: 86_400,
    list_dictionaries: 86_400,
    search_dictionary: 86_400,
    // The register of bodies, their units and their officials moves on the
    // order of months. A day-long window also keeps the 2.5 MB whole-register
    // fetch behind `search_organizations` to roughly once a day.
    search_organizations: 86_400,
    get_organization: 86_400,
    list_organization_units: 86_400,
    get_unit: 86_400,
    list_organization_signers: 86_400,
    get_signer: 86_400,
    list_positions: 86_400,
  },
};
