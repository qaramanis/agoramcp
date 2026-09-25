import { InvalidInputError, NotFoundError, RefusedAddressError, UpstreamError, fetchUntrusted, readCapped } from "@agoramcp/core";

/**
 * Reading the file behind a resource that is not in the datastore. This is
 * the messy end of a catalogue: what a publisher labelled `CSV` may be a
 * comma-separated file, a semicolon-separated one, a tab-separated one, a
 * GeoServer export with a geometry column, or an HTML page returned by a
 * server that lost the file. What is here reads the honest ones and says
 * which it refused, rather than guessing.
 */

/** Held in memory whole, so bounded. Tables worth reading here are far smaller. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface TableFile {
  kind: "table";
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
  delimiter: string;
  encoding: "utf-8" | "windows-1253";
}

export interface JsonFile {
  kind: "json";
  /** The document, or its first `limit` items when it is an array. */
  data: unknown;
  /** Items in the paged array — the document itself, or its `features`. */
  itemCount: number | null;
  returned: number | null;
}

export type ReadFile = TableFile | JsonFile;

/**
 * The file a resource links to. The link is the publisher's, not ours, so it
 * is fetched only from the public internet — a record pointing at a private
 * address, or at a page that redirects to one, is refused — and read no
 * further than `MAX_FILE_BYTES`, however the server sends it.
 */
export async function fetchFile(url: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const response = await open(url, signal);

  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new NotFoundError(`The publisher's server has no file at ${url} (404).`, { details: { url } });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(`${hostOf(url)} answered ${response.status} for the file.`, { status: 502, details: { url } });
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(url, declared);
  }

  const bytes = await readCapped(response, MAX_FILE_BYTES);
  if (!bytes) throw tooLarge(url);

  return { bytes, contentType: response.headers.get("content-type") };
}

async function open(url: string, signal: AbortSignal) {
  try {
    return await fetchUntrusted(url, {
      headers: { "user-agent": "agoramcp/0.1 (+https://github.com/qaramanis/agoramcp; open government data proxy)", accept: "*/*" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
  } catch (cause) {
    if (cause instanceof RefusedAddressError) {
      throw new InvalidInputError(`The file at ${url} is not fetched here: ${cause.message}`, { details: { url } });
    }
    throw new UpstreamError(`The file could not be fetched from ${hostOf(url)}.`, { cause, status: 502, details: { url } });
  }
}

/** `bytes` when the server declared them; a body cut off at the cap only says it was over. */
function tooLarge(url: string, bytes?: number): UpstreamError {
  const size = bytes === undefined ? `over ${MAX_FILE_BYTES / 1_048_576} MB` : `${Math.round(bytes / 1_048_576)} MB`;
  return new UpstreamError(`The file is ${size} — too large to read here. It can be downloaded from ${url}.`, {
    status: 413,
    details: { url, ...(bytes === undefined ? {} : { bytes }) },
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Greek public bodies still save spreadsheets as Windows-1253. UTF-8 is
 * tried first and strictly; a file that fails it is read as 1253.
 */
export function decode(bytes: Uint8Array): { text: string; encoding: TableFile["encoding"] } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1253").decode(bytes), encoding: "windows-1253" };
  }
}

/** What the bytes are, whatever the label said. */
export function sniff(text: string, contentType: string | null, format: string | null): "html" | "json" | "table" | "unknown" {
  const head = text.slice(0, 2_000).replace(/^\uFEFF/u, "").trimStart();
  if (/^<(?:!doctype\s+html|html|head|body|\?xml)/iu.test(head) || (contentType ?? "").includes("text/html")) {
    return head.startsWith("<?xml") ? "unknown" : "html";
  }
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  const label = (format ?? "").toUpperCase();
  if (["CSV", "TSV", "TXT", "TEXT"].includes(label) || (contentType ?? "").includes("csv") || (contentType ?? "").includes("text/plain")) {
    return "table";
  }
  // A comma- or semicolon-separated first line with a second line is a table.
  const lines = head.split(/\r?\n/u);
  if (lines.length >= 2 && /[,;\t|]/u.test(lines[0] ?? "")) return "table";
  return "unknown";
}

/** The delimiter that splits the first lines most consistently. */
export function sniffDelimiter(text: string): string {
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((line) => line.trim() !== "").slice(0, 10);
  let best = ",";
  let bestScore = -1;
  for (const delimiter of [",", ";", "\t", "|"]) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    // Consistent (same count on every line) and present.
    const score = min > 0 && min === max ? min * 10 : min > 0 ? min : 0;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

/** RFC 4180, plus the loose habits of exported spreadsheets: CRLF or LF, quotes doubled inside quotes. */
export function parseTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/u, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export function readTable(text: string, offset: number, limit: number): TableFile & { encoding: "utf-8" } {
  const delimiter = sniffDelimiter(text);
  const parsed = parseTable(text, delimiter);
  const header = parsed[0] ?? [];
  const columns = header.map((cell, index) => cell.trim() || `column${index + 1}`);
  const body = parsed.slice(1);
  const rows = body.slice(offset, offset + limit).map((cells) =>
    columns.map((_, index) => {
      const cell = cells[index];
      return cell === undefined || cell === "" ? null : cell;
    }),
  );
  return { kind: "table", columns, rows, rowCount: body.length, delimiter, encoding: "utf-8" };
}

export function readJson(text: string, offset: number, limit: number): JsonFile {
  const data: unknown = JSON.parse(text.replace(/^\uFEFF/u, ""));
  if (Array.isArray(data)) {
    const page = data.slice(offset, offset + limit);
    return { kind: "json", data: page, itemCount: data.length, returned: page.length };
  }
  // GeoJSON and similar: the array worth paging is `features`.
  if (data && typeof data === "object" && Array.isArray((data as { features?: unknown }).features)) {
    const features = (data as { features: unknown[] }).features;
    const page = features.slice(offset, offset + limit);
    return {
      kind: "json",
      data: { ...(data as object), features: page },
      itemCount: features.length,
      returned: page.length,
    };
  }
  return { kind: "json", data, itemCount: null, returned: null };
}
