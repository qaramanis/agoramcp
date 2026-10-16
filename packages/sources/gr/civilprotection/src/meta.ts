import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Πολιτική Προστασία — Κίνδυνος Πυρκαγιάς",
  description:
    "The daily wildfire risk forecast of the General Secretariat for Civil Protection: for each of the 148 areas of Greece its map divides the country into, tomorrow's risk category from 1 (low) to 5 (state of alert), read from the official map issued every afternoon of the fire season, 1 May to 31 October — by area, by region, or at a point.",
  publisher: "Υπουργείο Κλιματικής Κρίσης και Πολιτικής Προστασίας — Γενική Γραμματεία Πολιτικής Προστασίας",
  upstreamUrl: "https://civilprotection.gov.gr/arxeio-imerision-xartwn",
  // The site's terms (https://civilprotection.gov.gr/oroi-xrisis): «Το
  // περιεχόμενο διατίθεται ελεύθερα … με την προϋπόθεση ότι σε περίπτωση
  // αναπαραγωγής και περαιτέρω χρήσης του περιεχομένου, αυτό δεν θα
  // υφίσταται οποιαδήποτε τροποποίηση ή αλλοίωση και θα συνοδεύεται από
  // ευκρινή και διακριτή αναφορά στην πηγή προέλευσής του, εξαιρούμενης της
  // χρήσης του για εμπορικούς σκοπούς, σύμφωνα με τους ειδικότερους όρους της
  // διεθνούς άδειας Creative Commons (CC BY-NC-SA v.4.0)». Non-commercial,
  // share-alike, and no alteration: every answer carries the map itself, so
  // the original travels with what was read from it.
  license: "CC-BY-NC-SA-4.0 — the site's terms, which also ask that content be reproduced without alteration",
  attribution:
    "Γενική Γραμματεία Πολιτικής Προστασίας, Υπουργείο Κλιματικής Κρίσης και Πολιτικής Προστασίας — Ημερήσιος Χάρτης Πρόβλεψης Κινδύνου Πυρκαγιάς (civilprotection.gov.gr)",
  docsUrl: "https://civilprotection.gov.gr/sxedia-politikis-prostasias/ekdosi-imerisioy-harti-problepsis-kindynoy-pyrkagias-apo-tin-ggpp-kata-tin-antipyriki-periodo-2026",
  ttl: {
    // The archive changes once a day, around 12:30 Athens time, and the
    // site's own cache holds pages for ten minutes.
    default: 600,
  },
};
