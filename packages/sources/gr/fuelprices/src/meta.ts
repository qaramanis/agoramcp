import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Παρατηρητήριο Τιμών Υγρών Καυσίμων",
  description:
    "Greece's fuel price observatory: the average pump price of unleaded 95 and 100, diesel, autogas and, in winter, heating oil in each of the 51 prefectures and nationally, every day since March 2017 — and, from the weekly bulletin, how a litre's price splits into the refinery price, taxes and the retail margin.",
  publisher: "Υπουργείο Ανάπτυξης — Διατομεακή Μονάδα Ελέγχου Αγοράς (ΔΙ.Μ.Ε.Α.)",
  upstreamUrl: "https://www.fuelprices.gr/",
  // fuelprices.gr states no reuse licence: its terms (https://www.fuelprices.gr/terms.html)
  // are a disclaimer, saying the prices are posted «μόνο στην πληρέστερη,
  // καλύτερη και συνεχή ενημέρωση του καταναλωτή και στην συλλογή χρήσιμων
  // στατιστικών στοιχείων». The ministry lists the observatory on data.gov.gr
  // (dataset parathrhthrio-timwn-ygrwn-kaysimwn) as `other-open`, "Other
  // (Open)", with no licence text — the declaration this source relies on,
  // and the reason it reads only the published bulletins: the station search
  // sits behind a CAPTCHA that, the site says, is there to keep robots out.
  license: "Other (Open) — as the ministry declares it on data.gov.gr; fuelprices.gr itself states no licence",
  attribution: "Παρατηρητήριο Τιμών Υγρών Καυσίμων — Υπουργείο Ανάπτυξης (fuelprices.gr)",
  docsUrl: "https://www.fuelprices.gr/manual.pdf",
  ttl: {
    // A new daily bulletin appears once a day, around 12:30 Athens time,
    // for the day before; "latest" moves at most once a day.
    default: 3_600,
  },
};
