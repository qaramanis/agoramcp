import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Σεισμοί — Γεωδυναμικό Ινστιτούτο ΕΑΑ",
  description:
    "The Greek earthquake catalogue: every event the Institute of Geodynamics locates from the Hellenic Unified Seismic Network, from the barely-recorded to the destructive, with the time, place, depth and local magnitude of each and the quality of the solution behind it. Greece is the most seismically active country in Europe and this is the register of record for it — reviewed by an analyst rather than left as an automatic alert.",
  publisher: "Εθνικό Αστεροσκοπείο Αθηνών — Γεωδυναμικό Ινστιτούτο (NOA Institute of Geodynamics)",
  upstreamUrl: "https://eida.gein.noa.gr/",
  // Stated on the node that serves this API: "The content shared from our
  // services is licensed under a Creative Commons Attribution 4.0
  // International License. Copyright © Institute of Geodynamics — National
  // Observatory of Athens."
  license: "CC-BY-4.0",
  attribution:
    "Γεωδυναμικό Ινστιτούτο, Εθνικό Αστεροσκοπείο Αθηνών — Ελληνικό Ενοποιημένο Σεισμολογικό Δίκτυο (eida.gein.noa.gr)",
  docsUrl: "https://www.fdsn.org/webservices/",
  ttl: {
    // Seismicity is the one thing here that is genuinely live: a swarm adds
    // events every few minutes, and a caller asking twice in a session is
    // asking because the answer may have changed. Five minutes is the most
    // this can hold without reporting an aftershock sequence as it was.
    default: 300,
    // The "what just happened" call, and the one a page will poll.
    list_recent_earthquakes: 120,
    // A reviewed solution is revised in the hours after the event and then
    // settles. Half an hour is short enough to pick up a revision on the day
    // and long enough that reading one event repeatedly is free.
    get_earthquake: 1_800,
  },
};
