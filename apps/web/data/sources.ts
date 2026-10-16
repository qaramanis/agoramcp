/**
 * The official sources shown in the grid, in the order they should appear.
 *
 * Logos were downloaded from each publisher's own site into `public/logos/`.
 * They are marks owned by their publishers, shown as attribution — treat them
 * as the licence requires and swap in an official asset if one is provided.
 *
 * Names are Greeklish throughout, matching the rest of the site.
 */
export type SourceLogo = {
  name: string;
  /** Fallback label for a source with no logo file yet. */
  short: string;
  logo?: string;
  /** Dark-on-transparent marks need inverting to read on the dark square. */
  invert?: boolean;
  /**
   * The file ships with a solid light background instead of transparency.
   * Inverted it becomes a black box, which `screen` then blends away.
   */
  opaque?: boolean;
};

export const sources: SourceLogo[] = [
  { name: "gov.gr", short: "gov.gr", logo: "/logos/govgr.png", invert: true },
  { name: "Diavgeia", short: "Diavgeia", logo: "/logos/diavgeia.png", invert: true },
  { name: "data.gov.gr", short: "data.gov.gr", logo: "/logos/datagovgr.png" },
  { name: "Mitos", short: "Mitos", logo: "/logos/mitos.svg" },
  { name: "Dimos Athinaion", short: "Dimos Athinaion", logo: "/logos/athens.svg" },
  { name: "ELSTAT", short: "ELSTAT", logo: "/logos/elstat.png", invert: true },
  { name: "AADE", short: "AADE", logo: "/logos/aade.svg", invert: true },
  { name: "GEMI", short: "GEMI", logo: "/logos/gemi.png", invert: true, opaque: true },
  { name: "Vouli ton Ellinon", short: "Vouli", logo: "/logos/vouli.png", invert: true, opaque: true },
  { name: "Geodynamiko Institouto", short: "Geodynamiko", logo: "/logos/noa.svg", invert: true },
  { name: "ADMIE", short: "ADMIE", logo: "/logos/admie.svg", invert: true },
  { name: "Elliniko Ktimatologio", short: "Ktimatologio", logo: "/logos/ktimatologio.svg" },
  { name: "Politiki Prostasia", short: "Politiki Prostasia", logo: "/logos/civilprotection.png" },
  { name: "Ethniko Typografeio", short: "ET", logo: "/logos/et.png" },
  { name: "Eurostat", short: "Eurostat", logo: "/logos/eurostat.svg", invert: true },
  { name: "ECB", short: "ECB", logo: "/logos/ecb.svg", invert: true },
  // fuelprices.gr has no mark of its own, so this is its publisher's: the
  // Ministry of Development.
  { name: "Paratiritirio Timon Kafsimon", short: "Kafsima", logo: "/logos/fuelprices.png", invert: true, opaque: true },
];

/** Fixed for now — 2 rows across the 10 content columns. Add rows as sources land. */
export const SOURCE_GRID_COLUMNS = 10;
export const SOURCE_GRID_ROWS = 2;
