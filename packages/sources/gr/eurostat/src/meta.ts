import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Eurostat",
  description:
    "The European Union's statistical office: about 7,500 datasets of comparable figures — unemployment, inflation, GDP, wages, population, migration, tourism, energy, housing, health — for Greece and its regions next to every other member state and the EU and euro-area totals, harmonised so the comparison means something. Greece (EL) is the default; any country or region can be asked for.",
  publisher: "European Commission — Eurostat",
  upstreamUrl: "https://ec.europa.eu/eurostat/data/database",
  // Eurostat's copyright notice (https://ec.europa.eu/eurostat/help/copyright-notice):
  // "Reuse of statistical data, metadata, publications, and other
  // dissemination tools published on this website for commercial or
  // non-commercial purposes is authorised provided the source is
  // acknowledged. The reuse policy of the European Commission is implemented
  // by the Decision of 12 December 2011", and the editorial content "is
  // licensed under the Creative Commons Attribution 4.0 International
  // licence". Its exceptions are non-commercial only: data that belongs to
  // sources other than Eurostat, data on countries outside the EU, EFTA and
  // the candidate countries, and some Swiss, Liechtenstein and Austrian trade
  // data. `get_data` notes when an answer holds a country of the second kind.
  license: "CC-BY-4.0",
  attribution: "Source: Eurostat (ec.europa.eu/eurostat)",
  docsUrl: "https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction",
  ttl: {
    // Datasets are released at 11:00 and 23:00 CET; an hour keeps a release
    // from going unseen for long without fetching the same cube repeatedly.
    default: 3_600,
    // The catalogue and a dataset's dimensions change with a release at most.
    search_datasets: 21_600,
    get_dataset_structure: 21_600,
  },
};
