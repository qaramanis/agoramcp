import { createMemoryCache, InvalidInputError, NotFoundError } from "@agoramcp/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/**
 * A stand-in for fuelprices.gr, so nothing here reaches the real site. The
 * client captures `fetch` when its module loads, so the stand-in goes in
 * first and the client after it.
 */
let answer: (url: URL) => Response = () => new Response("", { status: 200 });
globalThis.fetch = async (input: string | URL | Request) => answer(new URL(input instanceof Request ? input.url : input));

const { fetchDaily, parseBreakdowns, parseDaily, parseListing } = await import("./client.ts");
const { garbleFold, PREFECTURES, prefectureFromPrinted, resolvePrefecture } = await import("./prefectures.ts");

beforeEach(() => {
  answer = () => new Response("", { status: 200 });
});

type Item = Parameters<typeof parseDaily>[0][number];
const item = (str: string, x: number, y: number, width = 20, page = 1): Item => ({ str, x: x - width / 2, y, width, page });

/** A header as the bulletins set it: two lines per fuel, centred on its column. */
const header = [
  item("Αμόλυβδη", 300, 480), item("95 οκτ.", 300, 465),
  item("Αμόλυβδη", 360, 480), item("100 οκτ.", 360, 465),
  item("Super", 420, 472),
  item("Diesel", 480, 480), item("Κίνησης", 480, 465),
  item("Diesel", 540, 480), item("Θέρμανσης", 540, 470),
  item("Υγραέριο", 600, 480), item("(Autogas)", 600, 458),
];

/** Every prefecture with one price, so a bulletin reads as whole. */
const filler = PREFECTURES.slice(2).map((prefecture, i) => [
  item(`ΝΟΜΟΣ ${prefecture.printed}`, 120, 300 - i * 5, 120),
  item("1,700", 300, 300 - i * 5),
]).flat();

describe("parseDaily", () => {
  test("places prices by column, so a blank cell does not shift the rest", () => {
    const bulletin = parseDaily(
      [
        ...header,
        // Super is blank for Arta: five prices for six columns.
        item("ΝΟΜΟΣ ΑΡΤΗΣ", 120, 440, 120), item("1,533", 300, 440), item("1,713", 360, 440),
        item("1,288", 480, 440), item("1,010", 540, 440), item("0,879", 600, 440),
        // Attica, with a price the PDF split in two, and drawn twice over itself.
        item("ΝΟΜΟΣ ΑΤΤΙΚΗΣ", 120, 450, 120), item("1,", 352, 450, 8), item("917", 364, 450, 16),
        item("1,503", 300, 450), item("1,503", 300, 450),
        ...filler,
      ],
      "2017-03-14",
      "u",
    );
    assert.deepEqual(bulletin.fuels, ["unleaded95", "unleaded100", "super", "diesel", "heating_oil", "autogas"]);
    const arta = bulletin.prefectures.find((row) => row.prefecture.printed === "ΑΡΤΗΣ");
    assert.deepEqual(arta?.prices, { unleaded95: 1.533, unleaded100: 1.713, diesel: 1.288, heating_oil: 1.01, autogas: 0.879 });
    const attica = bulletin.prefectures.find((row) => row.prefecture.printed === "ΑΤΤΙΚΗΣ");
    assert.deepEqual(attica?.prices, { unleaded95: 1.503, unleaded100: 1.917 });
  });

  test("reads a garbled font, a wrapped name and a national row split around its prices", () => {
    const bulletin = parseDaily(
      [
        ...header,
        // ΑΤΤΙΚΗΣ as one 2019 font map extracts it.
        item("ΝΟΜΟ΢ ΑΣΣΗΚΖ΢", 120, 450, 120), item("1,446", 300, 450),
        // A name in pieces, wrapped, prices beside its second line.
        item("ΝΟΜΟ΢ ΑΗΣΩΛΗΑ΢ ΚΑΗ", 120, 445, 120),
        item("ΑΚΑΡΝΑΝΗΑ΢", 120, 440, 80), item("1,645", 300, 440),
        // ΠΑΝΕΛΛΗΝΙΟΣ ΣΤΑΘΜΙΣΜΕΝΟΣ over its prices over Μ.Ο.
        item("ΠΑΝΔΛΛΖΝΗΟ΢ ΢ΣΑΘΜΗ΢ΜΔΝΟ΢", 160, 30, 150), item("1,481", 300, 25), item("0,000", 420, 25), item("Μ.Ο.", 160, 20),
        ...filler,
      ],
      "2019-01-14",
      "u",
    );
    assert.equal(bulletin.prefectures.length, 51);
    assert.equal(bulletin.prefectures.find((row) => row.prefecture.printed === "ΑΤΤΙΚΗΣ")?.prices.unleaded95, 1.446);
    assert.equal(bulletin.prefectures.find((row) => row.prefecture.name === "Αιτωλοακαρνανία")?.prices.unleaded95, 1.645);
    // "0,000" is how 2019 printed an empty cell.
    assert.deepEqual(bulletin.national, { unleaded95: 1.481, super: null });
  });

  test("refuses a layout it cannot place, rather than guess", () => {
    assert.throws(() => parseDaily([item("ΝΟΜΟΣ ΑΡΤΗΣ", 120, 440), item("1,533", 300, 440)], "d", "u"), /column headers/);
    assert.throws(() => parseDaily([...header, item("ΝΟΜΟΣ ΑΡΤΗΣ", 120, 440, 120), item("1,533", 300, 440)], "d", "u"), /Only 1 of the 51/);
  });
});

describe("prefectures", () => {
  test("the garble fold keeps all 51 names apart", () => {
    assert.equal(new Set(PREFECTURES.map((prefecture) => garbleFold(prefecture.printed))).size, 51);
    assert.equal(prefectureFromPrinted("ΓΩΓΔΚΑΝΖ΢ΟΤ")?.name, "Δωδεκάνησα");
  });

  test("a person's way of naming one", () => {
    for (const [given, name] of [["Άρτα", "Άρτα"], ["arta", "Άρτα"], ["Heraklion", "Ηράκλειο"], ["Santorini", "Κυκλάδες"], ["Νομός Αττικής", "Αττική"], ["αθηνα", "Αττική"]]) {
      assert.equal(resolvePrefecture(given as string).name, name);
    }
    assert.throws(() => resolvePrefecture("Atlantis"), InvalidInputError);
  });
});

describe("parseListing", () => {
  test("reads unpadded names and prefers the clean link over a dead twin", () => {
    const html = [
      '<a href="./files/deltia/IMERISIO_DELTIO_ANA_NOMO_6_11_2025.pdf">',
      '<a href="./files/deltia/IMERISIO_DELTIO_ANA_NOMO_25_09_2024 - ??????????.pdf">',
      '<a href="./files/deltia/IMERISIO_DELTIO_ANA_NOMO_25_09_2024.pdf">',
      '<a href="./files/deltia/IMERISIO_DELTIO_PANELLINIO_25_09_2024.pdf">',
    ].join("\n");
    assert.deepEqual(parseListing(html, "daily"), [
      { date: "2025-11-06", url: "https://www.fuelprices.gr/files/deltia/IMERISIO_DELTIO_ANA_NOMO_6_11_2025.pdf" },
      { date: "2024-09-25", url: "https://www.fuelprices.gr/files/deltia/IMERISIO_DELTIO_ANA_NOMO_25_09_2024.pdf" },
    ]);
  });

  test("keeps an odd name when it is the only link for its date", () => {
    const [weekly] = parseListing('<a href="./files/deltia/EBDOM_DELTIO_05_01_2018..pdf">', "weekly");
    assert.equal(weekly?.date, "2018-01-05");
  });
});

describe("fetchDaily", () => {
  test("a missing bulletin is an HTML page with a 200, and reads as not_found", async () => {
    answer = () => new Response("<textarea>/mnt/nas-1/…</textarea>", { headers: { "content-type": "text/html" } });
    await assert.rejects(
      fetchDaily({ date: "2026-10-14", url: "https://www.fuelprices.gr/files/deltia/X.pdf" }, createMemoryCache(), new AbortController().signal),
      NotFoundError,
    );
  });
});

describe("parseBreakdowns", () => {
  test("reads each fuel's sentences and checks they add up", () => {
    const text = [
      "2. Απλή Αμόλυβδη Βενζίνη 95 οκτανίων1",
      "2. α. Διαμόρφωση τιμής",
      "Η τιμή διυλιστηρίου της απλής αμόλυβδης βενζίνης 95 οκτανίων για την Πέμπτη 08-10-",
      "2026 διαμορφώθηκε στα 0,8862€ ανά λίτρο.",
      "Οι φόροι, τα τέλη και οι λοιπές επιβαρύνσεις αντιστοιχούν σε 1,1448€ ανά λίτρο.",
      "Η μέση τιμή λιανικής της απλής αμόλυβδης βενζίνης 95 οκτανίων για την Παρασκευή",
      "09/10/2026 διαμορφώθηκε στα 2,2010€ ανά λίτρο.",
      "Το εκτιμώμενο περιθώριο των πρατηριούχων και των εταιρειών εμπορίας υπολογίζεται",
      "κατά μέσο όρο στα 0,1700 ανά λίτρο (17 λεπτά).",
      "Η τελική τιμή λιανικής διαμορφώνεται από την τιμή διυλιστηρίου κατά 40,26% από τους",
      "φόρους (σταθερούς και μεταβλητούς) κατά 52,01%, και από τα εκτιμώμενα περιθώρια των",
      "εταιρειών εμπορίας, των μεταφορέων καυσίμων και των πρατηρίων κατά 7,72% (βλ.",
      "2. β. Χονδρική Τιμή Πώλησης",
      "3. Πετρέλαιο Κίνησης (Biodiesel)",
      "3. α. Διαμόρφωση τιμής",
      // No "στα", and a chart's labels in the middle of the retail sentence.
      "Η τιμή διυλιστηρίου του πετρελαίου κίνησης για την Πέμπτη 08/10/2026 διαμορφώθηκε",
      "0,9985€ ανά λίτρο.",
      "Οι φόροι, τα τέλη και οι λοιπές επιβαρύνσεις αντιστοιχούν σε 0,8409€ ανά λίτρο.",
      "Η μέση τιμή λιανικής του πετρελαίου κίνησης για την Παρασκευή 09/10/2026",
      "0\n500\n1.000\nEstonia",
      "διαμορφώθηκε στα 2,1270 € ανά λίτρο.",
      "Το εκτιμώμενο περιθώριο … υπολογίζεται κατά μέσο όρο στα 0,2876€ ανά λίτρο.",
      "3. β. Χονδρική Τιμή Πώλησης",
    ].join("\n");

    const [unleaded, diesel] = parseBreakdowns(text);
    assert.deepEqual(unleaded, {
      fuel: "unleaded95",
      refineryPrice: 0.8862,
      taxes: 1.1448,
      retailPrice: 2.201,
      margin: 0.17,
      shares: { refinery: 40.26, taxes: 52.01, margin: 7.72 },
      consistent: true,
    });
    assert.equal(diesel?.fuel, "diesel");
    assert.equal(diesel?.refineryPrice, 0.9985);
    assert.equal(diesel?.retailPrice, 2.127);
    assert.equal(diesel?.consistent, true);
    // A figure the bulletin does not state is null, not a guess.
    assert.deepEqual(diesel?.shares, { refinery: null, taxes: null, margin: null });
  });
});
