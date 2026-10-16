import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { isDateFormat, readWorkbook, serialToIso } from "./sheet.ts";

/* -------------------------------------------------------------------------- */
/* A tiny .xls, built here                                                    */
/* -------------------------------------------------------------------------- */

function record(type: number, body: number[]): number[] {
  return [type & 0xff, type >> 8, body.length & 0xff, body.length >> 8, ...body];
}
const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const f64 = (value: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return [...new Uint8Array(view.buffer)];
};
const wide = (text: string) => [...new Uint8Array(new Uint16Array([...text].map((c) => c.charCodeAt(0))).buffer)];
const narrow = (text: string) => [...text].map((c) => c.charCodeAt(0));

/**
 * A BIFF8 workbook with one sheet, holding what ΑΔΜΗΕ's files hold: shared
 * strings — one of them Greek and split across a CONTINUE record that
 * switches from one-byte to two-byte characters mid-string — a number, an
 * RK integer, an RK ×100 float, a run of MULRK, a formula with a cached
 * string, and a date.
 */
function biffStream(): Uint8Array {
  const sst = [
    ...u32(2), ...u32(2),
    ...u16(5), 0x00, ...narrow("TOTAL"),
    // "ΣΥΝΟΛΟ": six characters, the first two here as UTF-16…
    ...u16(6), 0x01, ...wide("ΣΥ"),
  ];
  // …and the rest in a CONTINUE record that opens with a fresh flags byte.
  const cont = [0x01, ...wide("ΝΟΛΟ")];

  const globals = (sheetAt: number) => [
    ...record(0x0809, [...u16(0x0600), ...u16(0x0005), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x041e, [...u16(164), ...u16(10), 0x00, ...narrow("dd/mm/yyyy")]),
    ...record(0x00e0, [0, 0, ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x00e0, [0, 0, ...u16(164), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x0085, [...u32(sheetAt), 0, 0, 5, 0x00, ...narrow("Daily")]),
    ...record(0x00fc, sst),
    ...record(0x003c, cont),
    ...record(0x000a, []),
  ];
  const sheetAt = globals(0).length;
  const sheet = [
    ...record(0x0809, [...u16(0x0600), ...u16(0x0010), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...record(0x00fd, [...u16(0), ...u16(1), ...u16(0), ...u32(1)]), // B1: "ΣΥΝΟΛΟ"
    ...record(0x00fd, [...u16(1), ...u16(1), ...u16(0), ...u32(0)]), // B2: "TOTAL"
    ...record(0x0203, [...u16(1), ...u16(2), ...u16(0), ...f64(4433.5)]), // C2
    ...record(0x027e, [...u16(1), ...u16(3), ...u16(0), ...u32((4079 << 2) | 0x02)]), // D2: RK integer
    ...record(0x027e, [...u16(1), ...u16(4), ...u16(0), ...u32((1234 << 2) | 0x03)]), // E2: RK 12.34
    ...record(0x00bd, [...u16(2), ...u16(1), ...u16(0), ...u32((7 << 2) | 2), ...u16(0), ...u32((8 << 2) | 2), ...u16(2)]), // B3:C3
    ...record(0x0006, [...u16(3), ...u16(1), ...u16(0), 0x00, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]), // B4: formula
    ...record(0x0207, [...u16(3), 0x00, ...narrow("SUM")]),
    ...record(0x0203, [...u16(4), ...u16(1), ...u16(1), ...f64(46309)]), // B5: a date, 2026-10-14
    ...record(0x000a, []),
  ];
  const stream = new Uint8Array(4_096);
  stream.set([...globals(sheetAt), ...sheet]);
  return stream;
}

/** That stream in an OLE2 compound file: 8 stream sectors, a directory, a FAT. */
function compoundFile(stream: Uint8Array): Uint8Array {
  const sector = 512;
  const file = new Uint8Array(sector * 11);
  const view = new DataView(file.buffer);
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, 8, true);
  view.setUint32(0x38, 4_096, true);
  view.setUint32(0x3c, 0xfffffffe, true);
  view.setUint32(0x44, 0xfffffffe, true);
  for (let i = 0; i < 109; i += 1) view.setUint32(0x4c + i * 4, i === 0 ? 9 : 0xffffffff, true);

  file.set(stream, sector);

  const directory = sector * 9;
  const entry = (index: number, name: string, type: number, start: number, size: number) => {
    const base = directory + index * 128;
    file.set(wide(`${name}\0`), base);
    view.setUint16(base + 0x40, (name.length + 1) * 2, true);
    view.setUint8(base + 0x42, type);
    view.setUint32(base + 0x74, start, true);
    view.setUint32(base + 0x78, size, true);
  };
  entry(0, "Root Entry", 5, 0xfffffffe, 0);
  entry(1, "Workbook", 2, 0, stream.byteLength);

  const fat = sector * 10;
  for (let i = 0; i < sector / 4; i += 1) view.setUint32(fat + i * 4, 0xffffffff, true);
  for (let i = 0; i < 7; i += 1) view.setUint32(fat + i * 4, i + 1, true);
  view.setUint32(fat + 7 * 4, 0xfffffffe, true);
  view.setUint32(fat + 8 * 4, 0xfffffffe, true);
  view.setUint32(fat + 9 * 4, 0xfffffffd, true);
  return file;
}

describe(".xls", () => {
  test("reads cells of every kind, and a shared string split across records", () => {
    const { sheets } = readWorkbook(compoundFile(biffStream()));
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0]?.name, "Daily");
    assert.deepEqual(sheets[0]?.rows, [
      [null, "ΣΥΝΟΛΟ"],
      [null, "TOTAL", 4433.5, 4079, 12.34],
      [null, 7, 8],
      [null, "SUM"],
      [null, "2026-10-14"],
    ]);
  });

  test("refuses a file that is not a workbook", () => {
    assert.throws(() => readWorkbook(new Uint8Array([1, 2, 3, 4])), /neither an \.xlsx nor an \.xls/);
    const broken = compoundFile(biffStream());
    new DataView(broken.buffer).setUint32(0x30, 99, true);
    assert.throws(() => readWorkbook(broken), /not a readable \.xls/);
  });
});

/* -------------------------------------------------------------------------- */
/* A tiny .xlsx                                                               */
/* -------------------------------------------------------------------------- */

describe(".xlsx", () => {
  test("follows relationships, reads shared, inline and rich strings, and dates by style", () => {
    const file = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook><workbookPr date1904="false"/><sheets><sheet name="Second" sheetId="2" r:id="rId9"/><sheet name="First" sheetId="1" r:id="rId3"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId3" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      ),
      "xl/sharedStrings.xml": strToU8('<sst><si><t>Load Forecast</t></si><si><r><t>Φορτίο </t></r><r><t>&amp; ΑΠΕ</t></r></si></sst>'),
      "xl/styles.xml": strToU8(
        '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="2"/></cellXfs></styleSheet>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" s="1"><v>46309</v></c><c r="D1" s="2"><v>4210.5</v></c></row>' +
          '<row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="inlineStr"><is><t>inline</t></is></c><c r="D3" t="b"><v>1</v></c><c r="E3" s="1"/></row></sheetData></worksheet>',
      ),
      "xl/worksheets/sheet2.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'),
      "xl/media/image1.png": new Uint8Array(1_000),
    });
    const { sheets } = readWorkbook(file);
    assert.deepEqual(
      sheets.map((sheet) => sheet.name),
      ["Second", "First"],
    );
    assert.deepEqual(sheets[1]?.rows, [["Load Forecast", null, "2026-10-14", 4210.5], [], [null, "Φορτίο & ΑΠΕ", "inline", true]]);
  });
});

describe("dates", () => {
  test("date formats are told from number formats", () => {
    assert.equal(isDateFormat(14, undefined), true);
    assert.equal(isDateFormat(164, "dd/mm/yyyy"), true);
    assert.equal(isDateFormat(165, "[$-408]dddd, dd mmmm, yyyy"), true);
    assert.equal(isDateFormat(166, '0.00" MWh"'), false);
    assert.equal(isDateFormat(0, "General"), false);
  });

  test("serials become ISO dates, times and moments", () => {
    assert.equal(serialToIso(46309, false), "2026-10-14");
    assert.equal(serialToIso(46309.5, false), "2026-10-14T12:00:00");
    assert.equal(serialToIso(0.75, false), "18:00:00");
    assert.equal(serialToIso(1, false), "1900-01-01");
    assert.equal(serialToIso(1, true), "1904-01-02");
  });
});
