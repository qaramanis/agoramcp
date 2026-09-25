import { InvalidInputError } from "@agoramcp/core";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidAfm, normalizeVat } from "./client.ts";

describe("isValidAfm", () => {
  test("accepts a real ΑΦΜ and rejects one digit off", () => {
    assert.equal(isValidAfm("094014201"), true);
    assert.equal(isValidAfm("094014202"), false);
  });

  test("rejects the one register number VIES also rejects, all zeros, and the wrong length", () => {
    assert.equal(isValidAfm("090300767"), false);
    assert.equal(isValidAfm("000000000"), false);
    assert.equal(isValidAfm("94014201"), false);
    assert.equal(isValidAfm("0940142011"), false);
  });
});

describe("normalizeVat", () => {
  test("reads the ways a number is written down", () => {
    for (const written of ["EL 094 014 201", "el-094014201", "094.014.201", "094014201"]) {
      const vat = normalizeVat(written, "EL");
      assert.deepEqual([vat.countryCode, vat.vatNumber, vat.fullVatNumber, vat.note], ["EL", "094014201", "EL094014201", null]);
    }
  });

  test("restores the leading zero a spreadsheet ate, and says so", () => {
    const vat = normalizeVat("94014201", "el");
    assert.equal(vat.vatNumber, "094014201");
    assert.match(vat.note ?? "", /leading zero was restored/);
  });

  test("refuses GR, a prefix that contradicts the country, and a mistyped ΑΦΜ", () => {
    const refuses = (input: string, country: string, message: RegExp) =>
      assert.throws(() => normalizeVat(input, country), (error) => error instanceof InvalidInputError && message.test(error.message));
    refuses("094014201", "GR", /Greece is EL, not GR/);
    refuses("DE094014201", "EL", /written for DE but countryCode says EL/);
    refuses("094014202", "EL", /fails the check-digit test/);
    refuses("", "EL", /Give a VAT number/);
    refuses("12345", "EL", /nine digits/);
  });
});
