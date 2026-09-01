/**
 * Greek to Latin the way ELOT 743 spells it — the standard behind Greek road
 * signs and passports, and what the hand-written names this site used to carry
 * followed: Διαύγεια → Diavgeia, Θεσσαλονίκη → Thessaloniki, Μπάμπης → Bampis.
 *
 * Names arrive from the MCP server in Greek, because that is how the registries
 * spell themselves, and the UI is English-language — so every *name* it shows
 * passes through here. Values do not: a search term or a code is sent as typed.
 */

const COMBINING_MARKS = /[\u0300-\u036f]/gu;
const GREEK = /\p{Script=Greek}/u;

/** One letter, accent already stripped, to its Latin spelling. */
const LETTERS: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i",
  κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s",
  ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** Pairs that spell differently from their two letters. */
const PAIRS: Record<string, string> = {
  ου: "ou", γγ: "ng", γκ: "gk", γξ: "nx", γχ: "nch", ντ: "nt",
};

/** After αυ, ευ or ηυ, one of these makes the υ a "v"; anything else an "f". */
const VOICED = "αεηιουωβγδζλμνρ";

export function greeklish(text: string): string {
  const original = [...text];
  // Accents go, but only off Greek letters — "Côte" is somebody's spelling.
  const bare = original.map((char) =>
    GREEK.test(char) ? char.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase() : char,
  );

  let out = "";
  for (let i = 0; i < bare.length; ) {
    const a = bare[i] ?? "";
    const b = bare[i + 1] ?? "";
    let latin: string | undefined;
    let taken = 1;

    if (PAIRS[a + b] !== undefined) {
      latin = PAIRS[a + b];
      taken = 2;
    } else if (b === "υ" && (a === "α" || a === "ε" || a === "η")) {
      const after = bare[i + 2] ?? "";
      latin = `${LETTERS[a]}${after !== "" && VOICED.includes(after) ? "v" : "f"}`;
      taken = 2;
    } else if (a === "μ" && b === "π") {
      // "b" opening a word, "mp" inside one: Μπάμπης is Bampis.
      latin = i === 0 || !GREEK.test(original[i - 1] ?? "") ? "b" : "mp";
      taken = 2;
    } else {
      latin = LETTERS[a];
    }

    if (latin === undefined) {
      out += original[i];
      i += 1;
      continue;
    }

    out += recase(latin, original, i, taken);
    i += taken;
  }

  return out;
}

/**
 * Carries the source's case over. A two-letter spelling goes all-capitals only
 * inside an all-capitals word — ΔΙΑΥΓΕΙΑ is DIAVGEIA, Θεσσαλονίκη is
 * Thessaloniki, not THessaloniki.
 */
function recase(latin: string, original: string[], at: number, taken: number): string {
  if (!isUpper(original[at])) return latin;
  if (latin.length === 1) return latin.toUpperCase();

  const wordIsCapitals =
    taken === 2
      ? isUpper(original[at + 1])
      : isUpper(original[at + 1]) || isUpper(original[at - 1]);

  return wordIsCapitals ? latin.toUpperCase() : `${latin[0]?.toUpperCase() ?? ""}${latin.slice(1)}`;
}

function isUpper(char: string | undefined): boolean {
  return char !== undefined && char !== char.toLowerCase();
}
