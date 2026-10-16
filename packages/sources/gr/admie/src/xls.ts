import { UpstreamError } from "@agoramcp/core";
import { isDateFormat, layOut, MAX_CELLS, serialToIso, type Cell, type Sheet, type Workbook } from "./sheet.ts";

/**
 * A legacy .xls — BIFF8 records inside an OLE2 compound file — as plain
 * sheets. ΑΔΜΗΕ's most useful daily files are still in this format (the
 * system realisation, the real-time SCADA series, MV renewables, reservoir
 * levels), so a reader for it is the price of the data. It reads what those
 * files hold and no more: the cell records, the shared strings, and the
 * formats that say which numbers are dates. Formulas give their cached
 * value; charts, styles beyond dates and anything encrypted are ignored.
 *
 * References: [MS-CFB] for the container, [MS-XLS] for the records.
 */

const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;

function fail(message: string): never {
  throw new UpstreamError(`The file is not a readable .xls workbook: ${message}.`);
}

/* -------------------------------------------------------------------------- */
/* The compound file                                                          */
/* -------------------------------------------------------------------------- */

/** The bytes of the `Workbook` stream (or `Book`, its BIFF5 name). */
export function workbookStream(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 512 || view.getUint32(0, true) !== 0xe011cfd0 || view.getUint32(4, true) !== 0xe11ab1a1) {
    fail("no compound-file signature");
  }

  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSectorSize = 1 << view.getUint16(0x20, true);
  const fatSectors = view.getUint32(0x2c, true);
  const firstDirectory = view.getUint32(0x30, true);
  const miniCutoff = view.getUint32(0x38, true);
  const firstMiniFat = view.getUint32(0x3c, true);
  let difatSector = view.getUint32(0x44, true);
  const sectors = Math.floor((bytes.byteLength - sectorSize) / sectorSize);
  const sectorAt = (id: number) => (id + 1) * sectorSize;

  // Where the FAT lives: the first 109 sector ids in the header, the rest
  // in a chain of DIFAT sectors, each ending with the next one's id.
  const fatIds: number[] = [];
  for (let i = 0; i < 109 && fatIds.length < fatSectors; i += 1) fatIds.push(view.getUint32(0x4c + i * 4, true));
  for (let guard = 0; difatSector !== END_OF_CHAIN && difatSector !== FREE_SECTOR && fatIds.length < fatSectors; guard += 1) {
    if (guard > sectors || difatSector >= sectors) fail("a broken DIFAT chain");
    const base = sectorAt(difatSector);
    const perSector = sectorSize / 4 - 1;
    for (let i = 0; i < perSector && fatIds.length < fatSectors; i += 1) fatIds.push(view.getUint32(base + i * 4, true));
    difatSector = view.getUint32(base + perSector * 4, true);
  }

  const fat: number[] = [];
  for (const id of fatIds) {
    if (id >= sectors) fail("a FAT sector outside the file");
    const base = sectorAt(id);
    for (let i = 0; i < sectorSize / 4; i += 1) fat.push(view.getUint32(base + i * 4, true));
  }

  /** A chain of sectors, concatenated; looping or running off the file is a corrupt file. */
  const chain = (start: number, table: number[], size: number, read: (id: number) => Uint8Array): Uint8Array => {
    const parts: Uint8Array[] = [];
    let id = start;
    for (let guard = 0; id !== END_OF_CHAIN; guard += 1) {
      if (guard > table.length || id >= table.length) fail("a broken sector chain");
      parts.push(read(id));
      id = table[id] as number;
    }
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out.subarray(0, Math.min(size, out.byteLength));
  };
  const sector = (id: number) => {
    if (id >= sectors) fail("a sector outside the file");
    return bytes.subarray(sectorAt(id), sectorAt(id) + sectorSize);
  };

  const directory = chain(firstDirectory, fat, Number.MAX_SAFE_INTEGER, sector);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  for (let offset = 0; offset + 128 <= directory.byteLength; offset += 128) {
    const nameLength = Math.max(0, Math.min(64, dir.getUint16(offset + 0x40, true)) - 2);
    const name = new TextDecoder("utf-16le").decode(directory.subarray(offset, offset + nameLength));
    entries.push({ name, type: dir.getUint8(offset + 0x42), start: dir.getUint32(offset + 0x74, true), size: dir.getUint32(offset + 0x78, true) });
  }

  const stream = entries.find((entry) => entry.type === 2 && (entry.name === "Workbook" || entry.name === "Book"));
  if (!stream) fail("no Workbook stream");
  if (stream.size >= miniCutoff) return chain(stream.start, fat, stream.size, sector);

  // A small stream lives in the mini stream, in 64-byte sectors of its own.
  const root = entries.find((entry) => entry.type === 5);
  if (!root) fail("no root entry for the mini stream");
  const miniStream = chain(root.start, fat, root.size, sector);
  const miniFatBytes = chain(firstMiniFat, fat, Number.MAX_SAFE_INTEGER, sector);
  const miniView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.byteLength; i += 4) miniFat.push(miniView.getUint32(i, true));
  return chain(stream.start, miniFat, stream.size, (id) =>
    miniStream.subarray(id * miniSectorSize, (id + 1) * miniSectorSize),
  );
}

/* -------------------------------------------------------------------------- */
/* BIFF8 records                                                              */
/* -------------------------------------------------------------------------- */

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const FORMAT = 0x041e;
const XF = 0x00e0;
const DATEMODE = 0x0022;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const BOOLERR = 0x0205;

interface BiffRecord {
  type: number;
  /** Offset of the record header in the stream, which BOUNDSHEET points at. */
  offset: number;
  data: Uint8Array;
}

function records(stream: Uint8Array): BiffRecord[] {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const out: BiffRecord[] = [];
  for (let offset = 0; offset + 4 <= stream.byteLength; ) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    out.push({ type, offset, data: stream.subarray(offset + 4, Math.min(stream.byteLength, offset + 4 + length)) });
    offset += 4 + length;
  }
  return out;
}

const latin1 = new TextDecoder("latin1");
const utf16 = new TextDecoder("utf-16le");

/**
 * A string's characters, compressed (one byte each, the high byte zero) or
 * not (UTF-16), as its flags byte says. Greek is always the second kind, so
 * no code page is involved.
 */
function chars(data: Uint8Array, offset: number, count: number, wide: boolean): string {
  return wide ? utf16.decode(data.subarray(offset, offset + count * 2)) : latin1.decode(data.subarray(offset, offset + count));
}

/** XLUnicodeString: a 16-bit count, a flags byte, the characters. */
function unicodeString(data: Uint8Array, offset: number): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (offset + 3 > data.byteLength) return "";
  const count = view.getUint16(offset, true);
  return chars(data, offset + 3, count, (data[offset + 2] ?? 0) & 0x01 ? true : false);
}

/**
 * The shared string table, which may run on through CONTINUE records. A
 * string's characters can break across one, and the new record then opens
 * with a fresh flags byte — the second half may be wide where the first was
 * not. A string's header, its rich-text runs and its phonetic block break
 * without one.
 */
function sharedStrings(parts: Uint8Array[]): string[] {
  const strings: string[] = [];
  let index = 0;
  let data = parts[0] ?? new Uint8Array(0);
  let position = 8;
  const total = data.byteLength >= 8 ? new DataView(data.buffer, data.byteOffset, 8).getUint32(4, true) : 0;

  const next = (): boolean => {
    index += 1;
    if (index >= parts.length) return false;
    data = parts[index] as Uint8Array;
    position = 0;
    return true;
  };
  const byte = (): number => {
    while (position >= data.byteLength) if (!next()) return 0;
    const value = data[position] ?? 0;
    position += 1;
    return value;
  };
  const u16 = () => byte() | (byte() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = (count: number) => {
    let left = count;
    while (left > 0) {
      if (position >= data.byteLength && !next()) return;
      const step = Math.min(left, data.byteLength - position);
      position += step;
      left -= step;
    }
  };

  for (let n = 0; n < total; n += 1) {
    if (position >= data.byteLength && !next()) break;
    const count = u16();
    let flags = byte();
    const runs = flags & 0x08 ? u16() : 0;
    const phonetic = flags & 0x04 ? u32() : 0;

    let text = "";
    let got = 0;
    while (got < count) {
      if (position >= data.byteLength) {
        if (!next()) break;
        flags = (flags & ~0x01) | (byte() & 0x01);
      }
      const wide = (flags & 0x01) === 1;
      const available = wide ? Math.floor((data.byteLength - position) / 2) : data.byteLength - position;
      const take = Math.min(available, count - got);
      text += chars(data, position, take, wide);
      position += take * (wide ? 2 : 1);
      got += take;
      if (take === 0 && available === 0 && position < data.byteLength) break;
    }
    skip(runs * 4);
    skip(phonetic);
    strings.push(text);
  }
  return strings;
}

/** An RK number: a 30-bit integer or the top 30 bits of a double, optionally ×100. */
function rk(value: number): number {
  let number: number;
  if (value & 0x02) {
    number = value >> 2;
  } else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, value & 0xfffffffc, true);
    number = buffer.getFloat64(0, true);
  }
  return value & 0x01 ? number / 100 : number;
}

/** Built-in BIFF format ids that are dates when no FORMAT record names them. */
const BUILTIN_DATE_IDS = [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47];

export function readXls(bytes: Uint8Array): Workbook {
  const all = records(workbookStream(bytes));
  const first = all[0];
  if (!first || first.type !== BOF) fail("no BIFF header");
  const version = new DataView(first.data.buffer, first.data.byteOffset, first.data.byteLength).getUint16(0, true);
  if (version !== 0x0600) fail(`BIFF version ${version.toString(16)}, where only BIFF8 (Excel 97 and later) is read`);

  // The workbook globals: sheet list, shared strings, formats, styles.
  const sheetsAt: { name: string; offset: number; kind: number }[] = [];
  const formats = new Map<number, string>();
  const xfFormat: number[] = [];
  let date1904 = false;
  let strings: string[] = [];
  let i = 1;
  for (; i < all.length; i += 1) {
    const record = all[i] as BiffRecord;
    const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
    if (record.type === EOF) break;
    if (record.type === BOUNDSHEET && record.data.byteLength >= 8) {
      const count = record.data[6] ?? 0;
      const wide = ((record.data[7] ?? 0) & 0x01) === 1;
      sheetsAt.push({ name: chars(record.data, 8, count, wide), offset: view.getUint32(0, true), kind: record.data[5] ?? 0 });
    } else if (record.type === SST) {
      const parts = [record.data];
      while (all[i + 1]?.type === CONTINUE) parts.push((all[(i += 1)] as BiffRecord).data);
      strings = sharedStrings(parts);
    } else if (record.type === FORMAT && record.data.byteLength >= 5) {
      formats.set(view.getUint16(0, true), unicodeString(record.data, 2));
    } else if (record.type === XF && record.data.byteLength >= 4) {
      xfFormat.push(view.getUint16(2, true));
    } else if (record.type === DATEMODE && record.data.byteLength >= 2) {
      date1904 = view.getUint16(0, true) === 1;
    }
  }

  const isDate = xfFormat.map((id) => isDateFormat(id, formats.get(id) ?? (BUILTIN_DATE_IDS.includes(id) ? "d" : undefined)));
  const number = (value: number, xf: number): Cell => (isDate[xf] ? serialToIso(value, date1904) : value);

  const byOffset = new Map(all.map((record, index) => [record.offset, index]));
  const sheets: Sheet[] = [];
  let total = 0;

  for (const at of sheetsAt) {
    // Chart sheets and macro sheets hold no cells worth reading.
    if (at.kind !== 0) continue;
    const start = byOffset.get(at.offset);
    if (start === undefined) continue;
    const cells = new Map<number, Map<number, Cell>>();
    const put = (row: number, column: number, value: Cell) => {
      if (value === null || value === "") return;
      total += 1;
      if (total > MAX_CELLS) throw new UpstreamError("The workbook has more cells than this reader will lay out.");
      const line = cells.get(row) ?? new Map<number, Cell>();
      line.set(column, value);
      cells.set(row, line);
    };

    let pendingString: { row: number; column: number } | null = null;
    for (let j = start + 1; j < all.length; j += 1) {
      const record = all[j] as BiffRecord;
      if (record.type === EOF) break;
      const data = record.data;
      if (data.byteLength < 6 && record.type !== STRING) continue;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const row = data.byteLength >= 2 ? view.getUint16(0, true) : 0;
      const column = data.byteLength >= 4 ? view.getUint16(2, true) : 0;

      switch (record.type) {
        case LABELSST:
          if (data.byteLength >= 10) put(row, column, strings[view.getUint32(6, true)] ?? null);
          break;
        case LABEL:
          put(row, column, unicodeString(data, 6));
          break;
        case NUMBER:
          if (data.byteLength >= 14) put(row, column, number(view.getFloat64(6, true), view.getUint16(4, true)));
          break;
        case RK:
          if (data.byteLength >= 10) put(row, column, number(rk(view.getUint32(6, true)), view.getUint16(4, true)));
          break;
        case MULRK: {
          const last = view.getUint16(data.byteLength - 2, true);
          for (let c = column, offset = 4; c <= last && offset + 6 <= data.byteLength - 2; c += 1, offset += 6) {
            put(row, c, number(rk(view.getUint32(offset + 2, true)), view.getUint16(offset, true)));
          }
          break;
        }
        case FORMULA: {
          if (data.byteLength < 14) break;
          // A cached number, or a marker: 0 a string in the next STRING
          // record, 1 a boolean, 2 an error, 3 an empty string.
          if (view.getUint16(12, true) === 0xffff) {
            const kind = data[6];
            if (kind === 0) pendingString = { row, column };
            else if (kind === 1) put(row, column, data[8] === 1);
          } else {
            put(row, column, number(view.getFloat64(6, true), view.getUint16(4, true)));
          }
          break;
        }
        case STRING:
          if (pendingString) put(pendingString.row, pendingString.column, unicodeString(data, 0));
          pendingString = null;
          break;
        case BOOLERR:
          if (data.byteLength >= 8 && data[7] === 0) put(row, column, data[6] === 1);
          break;
      }
    }

    sheets.push({ name: at.name, rows: layOut(cells) });
  }

  return { sheets };
}
