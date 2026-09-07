import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "VIES — Έλεγχος ΑΦΜ",
  description:
    "The EU VAT Information Exchange System: turns a VAT number into the name and address it is registered to. Greece answers with both, so a bare ΑΦΜ — the one a contract award, a decision or a procedures-registry record carries but never spells out — becomes a named company at an address. Validity is relayed live from each member state's own VAT register.",
  publisher: "European Commission — DG Taxation and Customs Union (TAXUD)",
  upstreamUrl: "https://ec.europa.eu/taxation_customs/vies/",
  // The Commission's reuse decision (2011/833/EU, CC-BY-4.0) covers Commission
  // documents and explicitly excepts third-party works. An answer here is
  // neither: VIES holds no register of its own, it forwards the question to
  // the member state and relays the reply, so the content belongs to that
  // state's tax administration — ΑΑΔΕ for Greece — which states no licence.
  license: "Not stated — each answer is relayed live from a member state's own VAT register",
  attribution:
    "VIES — European Commission, DG TAXUD (ec.europa.eu/taxation_customs/vies)· τα ελληνικά στοιχεία προέρχονται από το μητρώο ΦΠΑ της ΑΑΔΕ",
  docsUrl: "https://ec.europa.eu/taxation_customs/vies/#/technical-information",
  ttl: {
    // A VAT registration is a fact about a company that changes on the order
    // of years, and the join this source exists for — resolving the same
    // handful of contractors across a set of ΚΗΜΔΗΣ or Διαύγεια records —
    // asks the same question repeatedly within one session. An hour absorbs
    // that without letting a registration go stale enough to mislead.
    default: 3_600,
    // Availability is a live status, and it is the whole point of the tool:
    // a member state drops out for minutes at a time.
    list_member_states: 300,
  },
};
