import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "ΚΗΜΔΗΣ",
  description:
    "The Central Electronic Registry of Public Contracts (Κεντρικό Ηλεκτρονικό Μητρώο Δημοσίων Συμβάσεων): every step of Greek public procurement as the law requires it to be posted — the request for a purchase, the tender notice, the signed contract and the payment order — each with its ΑΔΑΜ code, the buying body, CPV items, amounts and the signed PDF.",
  publisher: "Υπουργείο Ψηφιακής Διακυβέρνησης — ΟΠΣ ΕΣΗΔΗΣ (Γ.Γ. Πληροφοριακών Συστημάτων & Ψηφιακής Διακυβέρνησης)",
  upstreamUrl: "https://cerpp.eprocurement.gov.gr/khmdhs-opendata",
  license: "CC-BY-4.0",
  attribution: "Κεντρικό Ηλεκτρονικό Μητρώο Δημοσίων Συμβάσεων — ΚΗΜΔΗΣ (eprocurement.gov.gr)",
  docsUrl: "https://cerpp.eprocurement.gov.gr/khmdhs-opendata/help",
  ttl: {
    // The open-data copy is refreshed from the registry once a day, so an
    // hour of staleness on a search costs nothing that a fresh call would fix.
    default: 3_600,
    // An act changes only when its body cancels or amends it, which posts a
    // new record rather than editing this one.
    get_document: 21_600,
    // The PDF is the signed act; it does not change.
    get_document_text: 86_400,
    // The register of bodies moves on the order of months.
    search_organizations: 86_400,
  },
};
