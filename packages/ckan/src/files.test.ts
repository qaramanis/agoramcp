import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decode, parseTable, readJson, readTable, sniff, sniffDelimiter } from "./files.ts";

describe("decode", () => {
  test("reads UTF-8 when the bytes are UTF-8", () => {
    const decoded = decode(new TextEncoder().encode("Δήμος,Αθηναίων"));
    assert.deepEqual(decoded, { text: "Δήμος,Αθηναίων", encoding: "utf-8" });
  });

  test("falls back to Windows-1253, which Greek spreadsheets are still saved in", () => {
    // "Αθήνα" in Windows-1253: not valid UTF-8.
    const decoded = decode(new Uint8Array([0xc1, 0xe8, 0xde, 0xed, 0xe1]));
    assert.deepEqual(decoded, { text: "Αθήνα", encoding: "windows-1253" });
  });
});

describe("sniff", () => {
  test("an HTML page is HTML whatever it was labelled", () => {
    assert.equal(sniff("<!DOCTYPE html><html>", "text/csv", "CSV"), "html");
    assert.equal(sniff("anything", "text/html; charset=utf-8", "CSV"), "html");
  });

  test("XML is not something this reads", () => {
    assert.equal(sniff('<?xml version="1.0"?><root/>', "application/xml", "XML"), "unknown");
  });

  test("JSON by its first character, past a BOM", () => {
    assert.equal(sniff('﻿{"type":"FeatureCollection"}', null, "CSV"), "json");
    assert.equal(sniff("[1,2]", null, null), "json");
  });

  test("a table by its label, its type, or the look of its first lines", () => {
    assert.equal(sniff("a b", null, "CSV"), "table");
    assert.equal(sniff("a b", "text/csv", null), "table");
    assert.equal(sniff("a;b\n1;2", null, null), "table");
    assert.equal(sniff("just one line", null, null), "unknown");
  });
});

describe("sniffDelimiter", () => {
  test("the delimiter that splits every line the same way wins", () => {
    assert.equal(sniffDelimiter("Δήμος;Σχολείο;Κατανάλωση\nΑΘΗΝΑΙΩΝ;1ο;12,5\nΠΕΙΡΑΙΑ;2ο;7,25"), ";");
    assert.equal(sniffDelimiter("a,b,c\n1,2,3"), ",");
    assert.equal(sniffDelimiter("a\tb\n1\t2"), "\t");
  });

  test("commas inside quotes are not counted", () => {
    assert.equal(sniffDelimiter('name;note\n"Smith, J.";"a, b"'), ";");
  });
});

describe("parseTable", () => {
  test("quotes, doubled quotes, CRLF, a BOM and blank lines", () => {
    const text = '﻿name,note\r\n"Smith, J.","said ""hi"""\r\n\r\nΑθήνα,\n';
    assert.deepEqual(parseTable(text, ","), [
      ["name", "note"],
      ["Smith, J.", 'said "hi"'],
      ["Αθήνα", ""],
    ]);
  });

  test("a newline inside quotes stays in the field", () => {
    assert.deepEqual(parseTable('a,b\n"one\ntwo",3', ","), [
      ["a", "b"],
      ["one\ntwo", "3"],
    ]);
  });
});

describe("readTable", () => {
  test("names blank headers, turns empty cells into null, and pages the body", () => {
    const table = readTable("id,,value\n1,x,\n2,y,20\n3,z,30", 1, 1);
    assert.deepEqual(table.columns, ["id", "column2", "value"]);
    assert.equal(table.rowCount, 3);
    assert.deepEqual(table.rows, [["2", "y", "20"]]);
    assert.deepEqual(readTable("id,,value\n1,x,", 0, 5).rows, [["1", "x", null]]);
  });
});

describe("readJson", () => {
  test("pages a top-level array", () => {
    assert.deepEqual(readJson("[1,2,3,4]", 1, 2), { kind: "json", data: [2, 3], itemCount: 4, returned: 2 });
  });

  test("pages a GeoJSON collection's features and keeps the rest", () => {
    const file = readJson(JSON.stringify({ type: "FeatureCollection", crs: "EPSG:2100", features: [1, 2, 3] }), 0, 2);
    assert.deepEqual(file, {
      kind: "json",
      data: { type: "FeatureCollection", crs: "EPSG:2100", features: [1, 2] },
      itemCount: 3,
      returned: 2,
    });
  });

  test("returns any other document whole", () => {
    assert.deepEqual(readJson('{"a":1}', 0, 10), { kind: "json", data: { a: 1 }, itemCount: null, returned: null });
  });

  test("throws on JSON that does not parse, for the tool to refuse", () => {
    assert.throws(() => readJson("{nope", 0, 1));
  });
});
