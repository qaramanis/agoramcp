import { UpstreamError } from "@agoramcp/core";
import { readXls } from "./xls.ts";
import { readXlsx } from "./xlsx.ts";

/**
 * A spreadsheet as plain data: what both readers produce, so nothing above
 * them knows whether a file was BIFF8 or OOXML. Cells are strings, numbers,
 * booleans or null; a cell formatted as a date is an ISO string.
 */
export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  /** Row-major, from A1. Sparse rows are filled with null; trailing nulls are trimmed. */
  rows: Cell[][];
}

export interface Workbook {
  sheets: Sheet[];
}

/**
 * The most cells either reader will lay out. ΑΔΜΗΕ's largest file, a
 * weekly offers workbook of 1.1 MB, is far below it; a zip bomb or a
 * corrupt dimension is not.
 */
export const MAX_CELLS = 2_000_000;

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The built-in number formats that are dates or times (ECMA-376 §18.8.30;
 * BIFF8 uses the same ids): 14–22 and 45–47.
 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * Whether a format code shows a date or a time: it has d, m, y, h or s
 * outside quoted text, escapes and [colour] brackets. `0.00` and `#,##0`
 * do not; `dd/mm/yyyy`, `hh:mm` and `[$-408]dddd, dd mmmm, yyyy` do.
 */
export function isDateFormat(id: number, code: string | undefined): boolean {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (code === undefined) return false;
  const bare = code
    .replace(/"[^"]*"/gu, "")
    .replace(/\\./gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/_./gu, "");
  return /[dmyhs]/iu.test(bare) && !/^general$/iu.test(bare.trim());
}

/**
 * A spreadsheet serial as an ISO date, a date and time when it has a
 * fraction, or a bare time when it is under one day (an `hh:mm` cell).
 * Serial 60 is the 29 February 1900 that never was, kept by Excel for Lotus
 * compatibility, so from 61 on the epoch is a day earlier; the 1904 system
 * counts from 1 January 1904 instead.
 */
export function serialToIso(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const iso = new Date(epoch + Math.round(serial * 86_400_000)).toISOString();
  if (serial >= 0 && serial < 1) return iso.slice(11, 19);
  return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 19);
}

/* -------------------------------------------------------------------------- */
/* Either format                                                              */
/* -------------------------------------------------------------------------- */

/** By the bytes rather than the name: a zip is OOXML, an OLE2 container is BIFF. */
export function readWorkbook(bytes: Uint8Array): Workbook {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return readXls(bytes);
  throw new UpstreamError("The file is neither an .xlsx nor an .xls workbook.");
}

/** A row list from sparse cells, with every row's trailing nulls trimmed. */
export function layOut(cells: Map<number, Map<number, Cell>>): Cell[][] {
  const lastRow = Math.max(-1, ...cells.keys());
  const rows: Cell[][] = [];
  for (let r = 0; r <= lastRow; r += 1) {
    const row = cells.get(r);
    if (!row || row.size === 0) {
      rows.push([]);
      continue;
    }
    const width = Math.max(...row.keys()) + 1;
    const out: Cell[] = new Array<Cell>(width).fill(null);
    for (const [c, value] of row) out[c] = value;
    while (out.length > 0 && (out.at(-1) === null || out.at(-1) === "")) out.pop();
    rows.push(out);
  }
  return rows;
}
