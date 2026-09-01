/**
 * The EU vocabularies a DCAT-AP catalogue writes as URIs — data themes,
 * update frequencies, dataset types, high-value-dataset categories, access
 * rights. Every entry here was read back from the Publications Office's own
 * authority tables (`skos:prefLabel`, en and el) on 1 Sep 2026 for the URIs
 * data.gov.gr actually uses; nothing is paraphrased. A URI not listed is
 * still returned, with its last path segment as the code and no label.
 */

export interface VocabularyTerm {
  /** The last segment of the URI: `EDUC`, `DAILY`, `c_ac64a52d`. */
  code: string;
  /** Greek label, as the Publications Office writes it. */
  name: string | null;
  nameEn: string | null;
  uri: string;
}

const LABELS: Record<string, { en: string; el: string }> = {
  // http://publications.europa.eu/resource/authority/data-theme/
  "data-theme/AGRI": { en: "Agriculture, fisheries, forestry and food", el: "Γεωργία, αλιεία, δασοκομία και τρόφιμα" },
  "data-theme/ECON": { en: "Economy and finance", el: "Οικονομία και χρηματοοικονομικά θέματα" },
  "data-theme/EDUC": { en: "Education, culture and sport", el: "Παιδεία, πολιτιστικά θέματα και αθλητισμός" },
  "data-theme/ENER": { en: "Energy", el: "Ενέργεια" },
  "data-theme/ENVI": { en: "Environment", el: "Περιβάλλον" },
  "data-theme/GOVE": { en: "Government and public sector", el: "Κυβέρνηση και δημόσιος τομέας" },
  "data-theme/HEAL": { en: "Health", el: "Υγεία" },
  "data-theme/INTR": { en: "International issues", el: "Διεθνή θέματα" },
  "data-theme/JUST": { en: "Justice, legal system and public safety", el: "Δικαιoσύνη, νομικό σύστημα και δημόσια ασφάλεια" },
  "data-theme/REGI": { en: "Regions and cities", el: "Περιφέρειες και πόλεις" },
  "data-theme/SOCI": { en: "Population and society", el: "Πληθυσμός και κοινωνία" },
  "data-theme/TECH": { en: "Science and technology", el: "Επιστήμη και τεχνολογία" },
  "data-theme/TRAN": { en: "Transport", el: "Μεταφορές" },
  // http://publications.europa.eu/resource/authority/frequency/
  "frequency/ANNUAL": { en: "annual", el: "ετήσιος" },
  "frequency/ANNUAL_2": { en: "semiannual", el: "εξαμηνιαίος" },
  "frequency/ANNUAL_3": { en: "three times a year", el: "τετραμηνιαίος" },
  "frequency/AS_NEEDED": { en: "as needed", el: "ανάλογα με τις ανάγκες" },
  "frequency/BIENNIAL": { en: "biennial", el: "διετής" },
  "frequency/BIMONTHLY": { en: "bimonthly", el: "διμηνιαίος" },
  "frequency/CONT": { en: "continuous", el: "συνεχής" },
  "frequency/DAILY": { en: "daily", el: "ημερήσιος" },
  "frequency/HOURLY": { en: "hourly", el: "ανά ώρα" },
  "frequency/IRREG": { en: "irregular", el: "μη τακτικός" },
  "frequency/MONTHLY": { en: "monthly", el: "μηνιαίος" },
  "frequency/MONTHLY_3": { en: "three times a month", el: "τρεις φορές τον μήνα" },
  "frequency/NEVER": { en: "never", el: "ποτέ" },
  "frequency/NOT_PLANNED": { en: "not planned", el: "δεν έχει προγραμματιστεί" },
  "frequency/OTHER": { en: "other", el: "άλλο" },
  "frequency/QUADRENNIAL": { en: "quadrennial", el: "ανά τετραετία" },
  "frequency/QUARTERLY": { en: "quarterly", el: "τριμηνιαίος" },
  "frequency/QUINQUENNIAL": { en: "quinquennial", el: "ανά πενταετία" },
  "frequency/TRIENNIAL": { en: "triennial", el: "τριετής" },
  "frequency/UNKNOWN": { en: "unknown", el: "άγνωστος" },
  "frequency/UPDATE_CONT": { en: "continuously updated", el: "ενημερώνεται συνεχώς" },
  "frequency/WEEKLY": { en: "weekly", el: "εβδομαδιαίος" },
  // http://publications.europa.eu/resource/authority/dataset-type/
  "dataset-type/DSCRP_SERV": { en: "Service description", el: "Περιγραφή υπηρεσίας" },
  "dataset-type/GEOSPATIAL": { en: "Geospatial data", el: "Γεωχωρικά δεδομένα" },
  "dataset-type/GLOSSARY": { en: "Glossary", el: "Γλωσσάριο" },
  "dataset-type/HVD": { en: "High-value dataset", el: "Σύνολo δεδομένων υψηλής αξίας" },
  "dataset-type/MAPPING": { en: "Mapping", el: "Αντιστοιχία" },
  "dataset-type/NAL": { en: "Named authority list", el: "Κατάλογος εγκεκριμένων ονομάτων αρχών" },
  "dataset-type/SCHEMA": { en: "Schema", el: "Σύστημα" },
  "dataset-type/STATISTICAL": { en: "Statistical data", el: "Στατιστικά δεδομένα" },
  "dataset-type/STYLES": { en: "Style sheets", el: "Φύλλα στυλ" },
  "dataset-type/SYNTHETIC_DATA": { en: "Synthetic data", el: "Συνθετικά δεδομένα" },
  "dataset-type/TAXONOMY": { en: "Taxonomy", el: "Ταξονομία" },
  "dataset-type/TEST_DATA": { en: "Test data", el: "Δεδομένα δοκιμής" },
  // http://data.europa.eu/bna/ — the high-value dataset categories of Regulation (EU) 2023/138
  "bna/c_164e0bf5": { en: "Meteorological", el: "Μετεωρολογικές πληροφορίες" },
  "bna/c_a9135398": { en: "Companies and company ownership", el: "Εταιρείες και ιδιοκτησιακό καθεστώς εταιρειών" },
  "bna/c_ac64a52d": { en: "Geospatial", el: "Γεωχωρικές πληροφορίες" },
  "bna/c_b79e35eb": { en: "Mobility", el: "Κινητικότητα" },
  "bna/c_dd313021": { en: "Earth observation and environment", el: "Γεωσκόπηση και περιβάλλον" },
  "bna/c_e1da4e07": { en: "Statistics", el: "Στατιστικές" },
  // http://publications.europa.eu/resource/authority/access-right/
  "access-right/PUBLIC": { en: "public", el: "δημόσιο" },
  // http://publications.europa.eu/resource/authority/licence/
  "licence/CC_BY_4_0": { en: "Creative Commons Attribution 4.0 International", el: "Creative Commons Αναφορά Δημιουργού 4.0 Διεθνές" },
};

/** The `{table}/{code}` tail of an authority URI, which is what the labels are keyed by. */
function tail(uri: string): string {
  const parts = uri.replace(/\/+$/u, "").split("/");
  return parts.slice(-2).join("/");
}

export function term(uri: string): VocabularyTerm {
  const labels = LABELS[tail(uri)];
  return {
    code: uri.replace(/\/+$/u, "").split("/").at(-1) ?? uri,
    name: labels?.el ?? null,
    nameEn: labels?.en ?? null,
    uri,
  };
}

/** A URI, or a JSON-encoded list of them, or nothing — as CKAN fields come. */
export function terms(value: unknown): VocabularyTerm[] {
  const uris: string[] = [];
  const push = (entry: unknown) => {
    if (typeof entry === "string" && entry.trim()) uris.push(entry.trim());
  };
  if (Array.isArray(value)) value.forEach(push);
  else if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) parsed.forEach(push);
    } catch {
      push(value);
    }
  } else push(value);

  return uris.map(term);
}
