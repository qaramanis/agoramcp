import { InvalidInputError } from "@agoramcp/core";

/**
 * The 51 prefectures the bulletins report on, Attica as one. `printed` is the
 * genitive the bulletin writes after ΝΟΜΟΣ; `name` the nominative a person
 * says; `latin` its Greeklish. `aliases` are the towns and islands people
 * ask about instead — accent folding alone cannot turn "Άρτα" into "ΑΡΤΗΣ",
 * or "Santorini" into the Cyclades.
 */
export interface Prefecture {
  printed: string;
  name: string;
  latin: string;
  aliases: readonly string[];
}

export const PREFECTURES: readonly Prefecture[] = [
  { printed: "ΑΤΤΙΚΗΣ", name: "Αττική", latin: "Attiki", aliases: ["Attica", "Athens", "Athina", "Αθήνα", "Piraeus", "Peiraias", "Πειραιάς"] },
  { printed: "ΑΙΤΩΛΙΑΣ ΚΑΙ ΑΚΑΡΝΑΝΙΑΣ", name: "Αιτωλοακαρνανία", latin: "Aitoloakarnania", aliases: ["Agrinio", "Αγρίνιο", "Mesolongi", "Μεσολόγγι"] },
  { printed: "ΑΡΓΟΛΙΔΟΣ", name: "Αργολίδα", latin: "Argolida", aliases: ["Argolis", "Nafplio", "Ναύπλιο", "Argos", "Άργος"] },
  { printed: "ΑΡΚΑΔΙΑΣ", name: "Αρκαδία", latin: "Arkadia", aliases: ["Arcadia", "Tripoli", "Τρίπολη"] },
  { printed: "ΑΡΤΗΣ", name: "Άρτα", latin: "Arta", aliases: [] },
  { printed: "ΑΧΑΪΑΣ", name: "Αχαΐα", latin: "Achaia", aliases: ["Achaea", "Patra", "Patras", "Πάτρα"] },
  { printed: "ΒΟΙΩΤΙΑΣ", name: "Βοιωτία", latin: "Voiotia", aliases: ["Boeotia", "Livadeia", "Λιβαδειά", "Thiva", "Thebes", "Θήβα"] },
  { printed: "ΓΡΕΒΕΝΩΝ", name: "Γρεβενά", latin: "Grevena", aliases: [] },
  { printed: "ΔΡΑΜΑΣ", name: "Δράμα", latin: "Drama", aliases: [] },
  { printed: "ΔΩΔΕΚΑΝΗΣΟΥ", name: "Δωδεκάνησα", latin: "Dodekanisa", aliases: ["Dodecanese", "Rhodes", "Rodos", "Ρόδος", "Kos", "Κως", "Kalymnos", "Κάλυμνος", "Karpathos", "Κάρπαθος"] },
  { printed: "ΕΒΡΟΥ", name: "Έβρος", latin: "Evros", aliases: ["Alexandroupoli", "Αλεξανδρούπολη"] },
  { printed: "ΕΥΒΟΙΑΣ", name: "Εύβοια", latin: "Evia", aliases: ["Euboea", "Evvoia", "Chalkida", "Chalkis", "Χαλκίδα"] },
  { printed: "ΕΥΡΥΤΑΝΙΑΣ", name: "Ευρυτανία", latin: "Evrytania", aliases: ["Karpenisi", "Καρπενήσι"] },
  { printed: "ΖΑΚΥΝΘΟΥ", name: "Ζάκυνθος", latin: "Zakynthos", aliases: ["Zante"] },
  { printed: "ΗΛΕΙΑΣ", name: "Ηλεία", latin: "Ileia", aliases: ["Ilia", "Elis", "Pyrgos", "Πύργος"] },
  { printed: "ΗΜΑΘΙΑΣ", name: "Ημαθία", latin: "Imathia", aliases: ["Veria", "Veroia", "Βέροια"] },
  { printed: "ΗΡΑΚΛΕΙΟΥ", name: "Ηράκλειο", latin: "Irakleio", aliases: ["Heraklion", "Iraklio", "Iraklion"] },
  { printed: "ΘΕΣΠΡΩΤΙΑΣ", name: "Θεσπρωτία", latin: "Thesprotia", aliases: ["Igoumenitsa", "Ηγουμενίτσα"] },
  { printed: "ΘΕΣΣΑΛΟΝΙΚΗΣ", name: "Θεσσαλονίκη", latin: "Thessaloniki", aliases: ["Salonica", "Saloniki"] },
  { printed: "ΙΩΑΝΝΙΝΩΝ", name: "Ιωάννινα", latin: "Ioannina", aliases: ["Giannena", "Γιάννενα"] },
  { printed: "ΚΑΒΑΛΑΣ", name: "Καβάλα", latin: "Kavala", aliases: ["Thasos", "Θάσος"] },
  { printed: "ΚΑΡΔΙΤΣΗΣ", name: "Καρδίτσα", latin: "Karditsa", aliases: [] },
  { printed: "ΚΑΣΤΟΡΙΑΣ", name: "Καστοριά", latin: "Kastoria", aliases: [] },
  { printed: "ΚΕΡΚΥΡΑΣ", name: "Κέρκυρα", latin: "Kerkyra", aliases: ["Corfu"] },
  { printed: "ΚΕΦΑΛΛΗΝΙΑΣ", name: "Κεφαλληνία", latin: "Kefallinia", aliases: ["Kefalonia", "Κεφαλονιά", "Cephalonia", "Argostoli", "Αργοστόλι", "Ithaca", "Ithaki", "Ιθάκη"] },
  { printed: "ΚΙΛΚΙΣ", name: "Κιλκίς", latin: "Kilkis", aliases: [] },
  { printed: "ΚΟΖΑΝΗΣ", name: "Κοζάνη", latin: "Kozani", aliases: ["Ptolemaida", "Πτολεμαΐδα"] },
  { printed: "ΚΟΡΙΝΘΙΑΣ", name: "Κορινθία", latin: "Korinthia", aliases: ["Corinthia", "Corinth", "Korinthos", "Κόρινθος"] },
  { printed: "ΚΥΚΛΑΔΩΝ", name: "Κυκλάδες", latin: "Kyklades", aliases: ["Cyclades", "Syros", "Σύρος", "Santorini", "Thira", "Σαντορίνη", "Mykonos", "Μύκονος", "Naxos", "Νάξος", "Paros", "Πάρος"] },
  { printed: "ΛΑΚΩΝΙΑΣ", name: "Λακωνία", latin: "Lakonia", aliases: ["Laconia", "Sparti", "Sparta", "Σπάρτη"] },
  { printed: "ΛΑΡΙΣΗΣ", name: "Λάρισα", latin: "Larisa", aliases: ["Larissa"] },
  { printed: "ΛΑΣΙΘΙΟΥ", name: "Λασίθι", latin: "Lasithi", aliases: ["Agios Nikolaos", "Άγιος Νικόλαος", "Ierapetra", "Ιεράπετρα"] },
  { printed: "ΛΕΣΒΟΥ", name: "Λέσβος", latin: "Lesvos", aliases: ["Lesbos", "Mytilene", "Mytilini", "Μυτιλήνη", "Lemnos", "Limnos", "Λήμνος"] },
  { printed: "ΛΕΥΚΑΔΟΣ", name: "Λευκάδα", latin: "Lefkada", aliases: ["Lefkas"] },
  { printed: "ΜΑΓΝΗΣΙΑΣ", name: "Μαγνησία", latin: "Magnisia", aliases: ["Magnesia", "Volos", "Βόλος", "Skiathos", "Σκιάθος", "Skopelos", "Σκόπελος"] },
  { printed: "ΜΕΣΣΗΝΙΑΣ", name: "Μεσσηνία", latin: "Messinia", aliases: ["Messenia", "Kalamata", "Καλαμάτα"] },
  { printed: "ΞΑΝΘΗΣ", name: "Ξάνθη", latin: "Xanthi", aliases: [] },
  { printed: "ΠΕΛΛΗΣ", name: "Πέλλα", latin: "Pella", aliases: ["Edessa", "Έδεσσα", "Giannitsa", "Γιαννιτσά"] },
  { printed: "ΠΙΕΡΙΑΣ", name: "Πιερία", latin: "Pieria", aliases: ["Katerini", "Κατερίνη"] },
  { printed: "ΠΡΕΒΕΖΗΣ", name: "Πρέβεζα", latin: "Preveza", aliases: [] },
  { printed: "ΡΕΘΥΜΝΗΣ", name: "Ρέθυμνο", latin: "Rethymno", aliases: ["Rethymnon"] },
  { printed: "ΡΟΔΟΠΗΣ", name: "Ροδόπη", latin: "Rodopi", aliases: ["Rhodope", "Komotini", "Κομοτηνή"] },
  { printed: "ΣΑΜΟΥ", name: "Σάμος", latin: "Samos", aliases: ["Ikaria", "Ικαρία"] },
  { printed: "ΣΕΡΡΩΝ", name: "Σέρρες", latin: "Serres", aliases: [] },
  { printed: "ΤΡΙΚΑΛΩΝ", name: "Τρίκαλα", latin: "Trikala", aliases: [] },
  { printed: "ΦΘΙΩΤΙΔΟΣ", name: "Φθιώτιδα", latin: "Fthiotida", aliases: ["Phthiotis", "Lamia", "Λαμία"] },
  { printed: "ΦΛΩΡΙΝΗΣ", name: "Φλώρινα", latin: "Florina", aliases: [] },
  { printed: "ΦΩΚΙΔΟΣ", name: "Φωκίδα", latin: "Fokida", aliases: ["Phocis", "Amfissa", "Άμφισσα", "Delphi", "Delfoi", "Δελφοί"] },
  { printed: "ΧΑΛΚΙΔΙΚΗΣ", name: "Χαλκιδική", latin: "Chalkidiki", aliases: ["Halkidiki", "Polygyros", "Πολύγυρος"] },
  { printed: "ΧΑΝΙΩΝ", name: "Χανιά", latin: "Chania", aliases: ["Hania", "Chanea"] },
  { printed: "ΧΙΟΥ", name: "Χίος", latin: "Chios", aliases: ["Hios"] },
];

/** Lower case, accents off, final sigma as sigma, so the ways a name is typed compare equal. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("ς", "σ").replace(/\s+/gu, " ").trim();
}

const LOOKUP = new Map<string, Prefecture>();
for (const prefecture of PREFECTURES) {
  for (const spelling of [prefecture.printed, prefecture.name, prefecture.latin, ...prefecture.aliases]) {
    LOOKUP.set(fold(spelling), prefecture);
  }
}

/** A prefecture as a person names it, in Greek or Greeklish, by its name or a town in it. */
export function resolvePrefecture(given: string): Prefecture {
  const key = fold(given).replace(/^(νομοσ|nomos|ν\.)\s*/u, "");
  const found = LOOKUP.get(key);
  if (found) return found;
  throw new InvalidInputError(
    `"${given}" is not one of the 51 prefectures the bulletins report on. Name it as a prefecture (Αττική, Thessaloniki, Kyklades) or by its main town or island (Patra, Heraklion, Santorini).`,
  );
}

/**
 * Some bulletins of 2018–2020 were set in a font whose map to Unicode is
 * wrong, so ΑΤΤΙΚΗΣ extracts as ΑΣΣΗΚΖ΢: in one variant Σ→΢ and Τ→Σ, in
 * another Δ→Γ, Ε→Δ … Η→Ζ, Ι→Η and Σ→΢, Τ→Σ, Υ→Τ, Χ→Υ. Each mistake moves a
 * letter to its neighbour, so folding each run of neighbours into one class
 * makes the garbled and the true names compare equal — and the 51 names stay
 * unique under it. Digits are never affected.
 */
export function garbleFold(text: string): string {
  return text
    .replaceAll("∆", "Δ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[ΓΔΕΖΗΙ]/gu, "1")
    .replace(/[΢ΣΤΥΧ]/gu, "2")
    .replace(/\s+/gu, "");
}

const BY_GARBLE = new Map(PREFECTURES.map((prefecture) => [garbleFold(prefecture.printed), prefecture]));

/** The prefecture a bulletin row names, as printed after ΝΟΜΟΣ, garbled or not. */
export function prefectureFromPrinted(printed: string): Prefecture | undefined {
  return BY_GARBLE.get(garbleFold(printed));
}
