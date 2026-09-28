import { setImmediate as nextTurn } from "node:timers/promises";

/**
 * The part of pdf.js's document proxy that `pageTexts` reads. Named by shape,
 * so core depends on no PDF library and a source passes what unpdf's
 * `getDocumentProxy` gave it.
 */
export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    /** Text items, and marked-content boundaries that carry no text. */
    getTextContent(): Promise<{ items: readonly object[] }>;
  }>;
}

/**
 * Each page's text, exactly as unpdf's `extractText` joins it — every item's
 * string, and a newline where an item ends a line — but one page at a time.
 * unpdf starts every page at once, which leaves no point to stop at and holds
 * the event loop for as long as a long document takes. Here the signal is
 * checked before each page, so a caller who has gone or a call past its
 * deadline stops the work, and every other request gets a turn between pages.
 */
export async function pageTexts(document: PdfDocument, signal: AbortSignal): Promise<string[]> {
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    signal.throwIfAborted();
    const content = await (await document.getPage(pageNumber)).getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      text += item.str;
      if ("hasEOL" in item && item.hasEOL) text += "\n";
    }
    pages.push(text);
    await nextTurn();
  }

  return pages;
}
