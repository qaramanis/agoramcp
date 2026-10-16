import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "ΑΔΜΗΕ — Λειτουργία & Αγορά Ηλεκτρικής Ενέργειας",
  description:
    "The Greek electricity transmission operator's published files: how much electricity Greece used each hour and day since 2011, what lignite, gas, hydro, renewables and batteries produced, how much crossed each border, tomorrow's load and renewables forecasts, reservoir levels — and every one of its 74 kinds of operating and market file, listed by day and read cell by cell.",
  publisher: "Ανεξάρτητος Διαχειριστής Μεταφοράς Ηλεκτρικής Ενέργειας Α.Ε. (ΑΔΜΗΕ / IPTO)",
  upstreamUrl: "https://www.admie.gr/agora/statistika-agoras/file-download-api",
  // ΑΔΜΗΕ states no reuse licence. Its terms of use
  // (https://www.admie.gr/oroi-hrisis) are a warranty disclaimer — «Τα
  // περιεχόμενα της δικτυακής πύλης παρέχονται «όπως ακριβώς έχουν» χωρίς
  // καμία εγγύηση» — and one restriction, against framing its pages. The
  // files are posted under the operator's regulatory transparency duties;
  // this source relays them without a licence to cite, as gr/athens does.
  license: "Not stated — published as the operator's market and operation files, under terms of use that disclaim warranty and grant no licence",
  attribution: "ΑΔΜΗΕ — Αρχεία Λειτουργίας & Αγοράς Ηλεκτρικής Ενέργειας (admie.gr)",
  docsUrl: "https://www.admie.gr/agora/statistika-agoras/file-download-api",
  ttl: {
    // Lists of files reaching the last two days are held briefly by the
    // tools; a published file never changes — a correction is a new version.
    default: 3_600,
    list_file_types: 86_400,
    read_file: 86_400,
    // A second version of yesterday's file can still appear; v2 of the
    // day-ahead forecast replaces v1 around 13:20.
    get_daily_energy: 3_600,
    get_forecast: 1_800,
  },
};
