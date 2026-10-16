/**
 * The status monitor's contract, shared by the server that answers a probe
 * and the web app that sends it and reads the answer. Imported by the web
 * app as `@agoramcp/core/probe`, so this file must stay free of the rest of
 * the package.
 */

/**
 * Marks a call as the monitor's. The server honours it only beside the
 * web app's proof (`PROXY_HEADER` carrying `PROXY_SECRET`): such a call skips
 * the cache, so it reaches the registry, and is not recorded, because the
 * monitor writes the row itself. Without the proof it is an ordinary call.
 */
export const PROBE_HEADER = "x-agoramcp-probe";

/** An argument a probe can send as a query string: no lists, no objects. */
export type ProbeValue = string | number | boolean;

/** What a working registry cannot answer without. See `SourceProbe.expect`. */
export interface ProbeExpectation {
  /** A dotted path into the answer, e.g. `count` or `rates`. */
  field: string;
  /** The least the field may hold: a number as it is, a list by its length. */
  atLeast: number;
  /** Why an answer short of it means the registry is not answering, for a person. */
  detail: string;
}

/**
 * How the status monitor asks a source whether it is answering: one tool,
 * called through the public API once a day with the cache skipped, so that
 * each check reaches the registry itself.
 *
 * The source chooses it because only the source knows its cheapest live
 * question. That is a search or a list, never a lookup of someone's record;
 * one whose fresh answer is small, since it is asked every day; and,
 * where it can be held to something, one whose answer cannot honestly be
 * empty — a registry that fails by answering with nothing is otherwise
 * reported as up.
 */
export interface SourceProbe {
  tool: string;
  /** The arguments, checked against the tool's schema at boot. Defaults to the tool's `example`. */
  input?: Record<string, ProbeValue>;
  /**
   * When the answer falls short of this, the check is reported as not
   * answering, under the code `empty`, with the expectation's `detail`.
   */
  expect?: ProbeExpectation;
}

/** A source's probe with its defaults filled in: what the monitor actually sends. */
export interface ResolvedProbe {
  tool: string;
  input: Record<string, ProbeValue>;
  expect: ProbeExpectation | null;
}

/**
 * Whether an answer falls short of a probe's expectation. The path is
 * followed key by key; a list counts by its length, a number as it is, and
 * a field that is missing or of any other kind falls short — an answer that
 * does not have the shape the probe was written for is no evidence of a
 * working registry.
 */
export function fallsShort(data: unknown, expect: ProbeExpectation): boolean {
  let value: unknown = data;
  for (const key of expect.field.split(".")) {
    if (value === null || typeof value !== "object") return true;
    value = (value as Record<string, unknown>)[key];
  }
  const measure = Array.isArray(value) ? value.length : typeof value === "number" ? value : Number.NaN;
  return !(measure >= expect.atLeast);
}
