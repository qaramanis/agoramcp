import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pageTexts, type PdfDocument } from "./pdf.ts";

/** A document of `pages` pages, each with a line, a marked-content boundary and a line that does not end. */
function fakeDocument(pages: number, onPage: (pageNumber: number) => void = () => {}): PdfDocument {
  return {
    numPages: pages,
    async getPage(pageNumber) {
      onPage(pageNumber);
      return {
        async getTextContent() {
          return {
            items: [
              { str: `Σελίδα ${pageNumber}`, hasEOL: true },
              { type: "beginMarkedContent", id: "mc0" },
              { str: "", hasEOL: false },
              { str: "τέλος", hasEOL: false },
            ],
          };
        },
      };
    },
  };
}

describe("pageTexts", () => {
  test("joins each page the way unpdf's extractText does", async () => {
    assert.deepEqual(await pageTexts(fakeDocument(2), new AbortController().signal), ["Σελίδα 1\nτέλος", "Σελίδα 2\nτέλος"]);
  });

  test("stops at the next page once the signal aborts", async () => {
    const controller = new AbortController();
    const read: number[] = [];
    const document = fakeDocument(100, (pageNumber) => {
      read.push(pageNumber);
      if (pageNumber === 3) controller.abort();
    });
    await assert.rejects(pageTexts(document, controller.signal), (error) => (error as Error).name === "AbortError");
    assert.deepEqual(read, [1, 2, 3]);
  });

  test("gives the event loop a turn between pages", async () => {
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    await pageTexts(fakeDocument(200), new AbortController().signal);
    clearInterval(timer);
    assert.ok(ticks > 0, "a timer never ran while the document was read");
  });
});
