import { UpstreamError } from "@agoramcp/core";
import { strFromU8, unzipSync } from "fflate";
import { isDateFormat, layOut, MAX_CELLS, serialToIso, type Cell, type Sheet, type Workbook } from "./sheet.ts";

/**
 * The most an .xlsx may inflate to. Sizes inside a zip are the zip's own
 * claim, so the filter checks the declared size and the result is counted
 * again after inflating.
 */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
    if (/^#x/iu.test(entity)) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function attribute(tag: string, name: string): string | undefined {
  const value = new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1];
  return value === undefined ? undefined : decodeXml(value);
}

/** Every `<t>` inside an element, joined: a plain string or a rich one in runs. */
function textOf(xml: string): string {
  let out = "";
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)) out += decodeXml(match[1] ?? "");
  return out;
}

/** "B12" → [11, 1]. */
function position(reference: string): [number, number] | undefined {
  const match = /^([A-Z]+)(\d+)$/u.exec(reference);
  if (!match) return undefined;
  let column = 0;
  for (const letter of match[1] ?? "") column = column * 26 + (letter.charCodeAt(0) - 64);
  return [Number(match[2]) - 1, column - 1];
}

/**
 * An .xlsx as plain sheets. Only the parts that hold cells are inflated —
 * the workbook, its relationships, the shared strings, the styles and the
 * worksheets — not the printer settings and images ΑΔΜΗΕ's files also carry.
 *
 * Read with patterns rather than an XML parser: the parts are
 * machine-written and flat, and the reader needs a cell's reference, type,
 * style and value and nothing else.
 */
export function readXlsx(bytes: Uint8Array): Workbook {
  let declared = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        const wanted =
          file.name === "xl/workbook.xml" ||
          file.name === "xl/_rels/workbook.xml.rels" ||
          file.name === "xl/sharedStrings.xml" ||
          file.name === "xl/styles.xml" ||
          /^xl\/worksheets\/[^/]+\.xml$/u.test(file.name);
        if (wanted) declared += file.originalSize;
        if (declared > MAX_INFLATED_BYTES) throw new UpstreamError("The workbook inflates to more than this reader will hold.");
        return wanted;
      },
    });
  } catch (cause) {
    if (cause instanceof UpstreamError) throw cause;
    throw new UpstreamError("The file is not a readable .xlsx workbook.", { cause });
  }
  const inflated = Object.values(files).reduce((sum, file) => sum + file.byteLength, 0);
  if (inflated > MAX_INFLATED_BYTES) throw new UpstreamError("The workbook inflates to more than this reader will hold.");

  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new UpstreamError("The .xlsx has no workbook part.");

  // "false" is a string, and truthy: read it.
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/u.test(workbook);

  const targets = new Map<string, string>();
  for (const match of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)\/?>/gu)) {
    const id = attribute(match[1] ?? "", "Id");
    const target = attribute(match[1] ?? "", "Target");
    if (!id || !target) continue;
    targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const shared: string[] = [];
  for (const match of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/gu)) shared.push(textOf(match[1] ?? ""));

  // Style index → whether the cell shows a date.
  const styles = text("xl/styles.xml");
  const formats = new Map<number, string>();
  for (const match of styles.matchAll(/<numFmt\b([^>]*)\/?>/gu)) {
    const id = Number(attribute(match[1] ?? "", "numFmtId"));
    const code = attribute(match[1] ?? "", "formatCode");
    if (Number.isInteger(id) && code !== undefined) formats.set(id, code);
  }
  const dateStyles: boolean[] = [];
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/u.exec(styles)?.[1] ?? "";
  for (const match of cellXfs.matchAll(/<xf\b([^>]*)\/?>/gu)) {
    const id = Number(attribute(match[1] ?? "", "numFmtId") ?? 0);
    dateStyles.push(isDateFormat(id, formats.get(id)));
  }

  const sheets: Sheet[] = [];
  let total = 0;
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/gu)) {
    const name = attribute(match[1] ?? "", "name") ?? `Sheet${sheets.length + 1}`;
    const id = attribute(match[1] ?? "", "r:id");
    const xml = id === undefined ? "" : text(targets.get(id) ?? "");
    const cells = new Map<number, Map<number, Cell>>();

    for (const cell of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const tag = cell[1] ?? "";
      const body = cell[2] ?? "";
      const at = position(attribute(tag, "r") ?? "");
      if (!at) continue;
      const type = attribute(tag, "t") ?? "n";
      const raw = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1];

      let value: Cell = null;
      if (type === "s") value = raw === undefined ? null : (shared[Number(raw)] ?? null);
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = raw === undefined ? null : decodeXml(raw);
      else if (type === "b") value = raw === "1";
      else if (raw !== undefined) {
        const number = Number(raw);
        const style = Number(attribute(tag, "s") ?? 0);
        value = Number.isFinite(number) ? (dateStyles[style] ? serialToIso(number, date1904) : number) : decodeXml(raw);
      }
      if (value === null || value === "") continue;

      total += 1;
      if (total > MAX_CELLS) throw new UpstreamError("The workbook has more cells than this reader will lay out.");
      const [r, c] = at;
      const row = cells.get(r) ?? new Map<number, Cell>();
      row.set(c, value);
      cells.set(r, row);
    }

    sheets.push({ name, rows: layOut(cells) });
  }

  return { sheets };
}
