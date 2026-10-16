import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Εθνικό Τυπογραφείο — ΦΕΚ",
  description:
    "The Government Gazette (Εφημερίς της Κυβερνήσεως): every law, presidential decree and act of legislative content by its number and year, every ΦΕΚ issue of every series — Α laws, Β ministerial decisions, Δ planning, Γ appointments and the rest — by number, date or the words in it, which later acts amended a law and which earlier ones it amends, and the text of the issue itself.",
  publisher: "Εθνικό Τυπογραφείο — Προεδρία της Κυβέρνησης",
  upstreamUrl: "https://search.et.gr/",
  // Neither API publishes terms. The portal's own terms of use (§2.4,
  // https://search.et.gr/el/oroi-xrisis/) claim its content for the
  // Presidency of the Government and forbid reproduction "για εμπορικούς
  // σκοπούς ή/και για μη προσωπική χρήση" without permission. Against that,
  // ν. 2121/1993, άρθρο 2 παρ. 5 puts official texts outside copyright: «Η
  // προστασία του παρόντος νόμου δεν εκτείνεται σε επίσημα κείμενα με τα
  // οποία εκφράζεται η άσκηση πολιτειακής αρμοδιότητας και ιδίως σε
  // νομοθετικά, διοικητικά ή δικαστικά κείμενα». The laws and decisions are
  // the second kind; the portal's indexing and metadata are the first.
  license:
    "Not stated — official legislative and administrative texts are outside copyright (ν. 2121/1993, άρθρο 2 παρ. 5); the portal's terms reserve its own content",
  attribution: "Εφημερίς της Κυβερνήσεως — Εθνικό Τυπογραφείο (search.et.gr)",
  docsUrl: "https://search.et.gr/el/",
  ttl: {
    // A search that reaches the current year can gain a new issue at any time.
    // Searches over closed periods are held for a day by the tools themselves.
    default: 3_600,
    search_gazette: 900,
    // Later acts keep adding to an issue's timeline: an amendment can land any
    // week.
    get_gazette_issue: 21_600,
    // A published issue does not change; the odd re-upload changes no text.
    get_gazette_text: 86_400,
  },
};
