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
    // A published decision is immutable; a correction arrives as a new version
    // with a new ΑΔΑ, so the old one stays valid indefinitely.
    get_decision: 3_600,
    // The controlled vocabulary changes when the law does — i.e. rarely.
    list_decision_types: 86_400,
    list_thematic_categories: 86_400,
    // The register of bodies, their units and their officials moves on the
    // order of months. A day-long window also keeps the 2.5 MB whole-register
    // fetch behind `search_organizations` to roughly once a day.
    search_organizations: 86_400,
    get_organization: 86_400,
    list_organization_units: 86_400,
    get_signer: 86_400,
  },
};
