import { z } from "zod";
import type { Cache } from "./cache.ts";
import type { Logger } from "./logger.ts";
import type { ProbeValue, ResolvedProbe, SourceProbe } from "./probe.ts";

/**
 * Provenance and caching policy for one upstream. `license` and `attribution`
 * are not decoration: most Greek open-data licences require the attribution to
 * travel with the data, and the landing page renders these verbatim.
 */
export interface SourceMeta {
  /** Display name, in the source's own language where that reads better. */
  name: string;
  description: string;
  /** The body that publishes the data. */
  publisher: string;
  /** Canonical URL of the upstream API or portal. */
  upstreamUrl: string;
  /** SPDX identifier where one exists, otherwise the licence's name. */
  license: string;
  attribution: string;
  /** Documentation the contributor worked from. */
  docsUrl?: string;
  /**
   * Cache lifetime in seconds. `default` applies to every tool; add a key per
   * tool name to override it — a price feed and a registry age very differently.
   */
  ttl: { default: number } & Record<string, number>;
  /** Env vars this source needs. Absent ones disable it with a clear error. */
  requiresEnv?: readonly string[];
}

/** Everything a tool handler is given beyond its own validated input. */
export interface ToolContext {
  cache: Cache;
  logger: Logger;
  /** Cache lifetime for the tool being invoked, resolved from `meta.ttl`. */
  ttl: number;
  /** Aborts when the client disconnects — pass it to every upstream call. */
  signal: AbortSignal;
  /** Process env, injected so handlers stay testable. */
  env: Readonly<Partial<Record<string, string>>>;
}

/**
 * Hints the MCP client shows to users and models. All optional and advisory.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface SourceTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** Unique within the source; becomes the MCP tool name. */
  name: string;
  /** Short human-readable label. */
  title: string;
  /**
   * The model picks tools from this text alone. Say what the tool returns,
   * what the arguments mean, and what it cannot answer.
   */
  description: string;
  inputSchema: Shape;
  annotations?: ToolAnnotations;
  /**
   * Arguments a demonstration starts on: one real call that answers quickly
   * and returns something worth reading. Checked against `inputSchema` at
   * boot, so it cannot drift from the schema it exercises. The landing page's
   * live console prefills every tool from this; a tool without one starts
   * blank. Literal values only — a date computed at import time would differ
   * between server and browser renders.
   */
  example?: z.input<z.ZodObject<Shape>>;
  /**
   * Returns plain data; the server serialises it into MCP content. Throw an
   * `AgoraError` for anything the model should see as a failure.
   */
  handler: (input: z.output<z.ZodObject<Shape>>, context: ToolContext) => Promise<unknown>;
}

/**
 * A tool whose input shape has been erased so tools of different shapes can
 * share one array. `defineTool` preserves inference at the definition site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySourceTool = SourceTool<any>;

/** What a warm-up gets: no tool is being invoked, so no input and no per-tool TTL. */
export type WarmContext = Pick<ToolContext, "cache" | "logger" | "signal" | "env">;

export interface Source {
  /** Slug, unique within the country: `diavgeia`, `quakes`. */
  id: string;
  /** ISO 3166-1 alpha-2, lowercase: `gr`. */
  country: string;
  meta: SourceMeta;
  tools: readonly AnySourceTool[];
  /**
   * Optional prefetch, run once at boot in the background. A source whose
   * first call would otherwise pay for something slow — a whole register, a
   * large vocabulary — moves that cost off its first caller here. A failure is
   * logged and ignored: every tool must work without it.
   */
  warm?: (context: WarmContext) => Promise<void>;
  /** How the status monitor checks it. Absent: its first tool, with that tool's example. */
  probe?: SourceProbe;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COUNTRY = /^[a-z]{2}$/;

/**
 * Identity helper that keeps `input` inferred from `inputSchema` inside the
 * handler, which a bare object literal in a `tools` array would lose.
 */
export function defineTool<Shape extends z.ZodRawShape>(tool: SourceTool<Shape>): SourceTool<Shape> {
  return tool;
}

/** Validates a source at import time, so a malformed one fails at boot. */
export function defineSource(source: Source): Source {
  if (!COUNTRY.test(source.country)) {
    throw new Error(
      `Source "${source.id}": country must be a lowercase ISO 3166-1 alpha-2 code, got "${source.country}".`,
    );
  }
  if (!SLUG.test(source.id)) {
    throw new Error(`Source id "${source.id}" must be lowercase kebab-case.`);
  }
  if (source.tools.length === 0) {
    throw new Error(`Source "${source.country}/${source.id}" declares no tools.`);
  }

  const seen = new Set<string>();
  for (const tool of source.tools) {
    if (!SLUG.test(tool.name.replaceAll("_", "-"))) {
      throw new Error(
        `Tool "${tool.name}" in "${source.country}/${source.id}" must be lowercase snake_case.`,
      );
    }
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool "${tool.name}" in "${source.country}/${source.id}".`);
    }
    seen.add(tool.name);

    if (tool.example !== undefined) {
      const parsed = z.object(tool.inputSchema).safeParse(tool.example);
      if (!parsed.success) {
        throw new Error(
          `Example for tool "${tool.name}" in "${source.country}/${source.id}" does not satisfy its own schema: ${z.prettifyError(parsed.error)}`,
        );
      }
    }
  }

  // A declared probe is resolved now, so one that names no tool, sends what
  // the schema refuses, or cannot travel as a query string fails at boot
  // rather than as a red light on the status page.
  if (source.probe) probeFor(source);

  return source;
}

/**
 * The probe the monitor runs for a source: the declared one, or its first
 * tool with that tool's example, as the monitor did before sources declared
 * one. A declared probe that cannot be sent throws.
 */
export function probeFor(source: Source): ResolvedProbe {
  const where = `"${source.country}/${source.id}"`;
  if (!source.probe) {
    const first = source.tools[0];
    return { tool: first?.name ?? "", input: (first?.example ?? {}) as Record<string, ProbeValue>, expect: null };
  }

  const name = source.probe.tool;
  const tool = source.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`The probe of ${where} names "${name}", which is not one of its tools.`);

  const input = (source.probe.input ?? tool.example ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(input)) {
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(
        `The probe of ${where} sends "${key}" as ${Array.isArray(value) ? "a list" : typeof value}; it is sent as a query string, so every argument must be a string, a number or a boolean.`,
      );
    }
  }
  const parsed = z.object(tool.inputSchema).safeParse(input);
  if (!parsed.success) {
    throw new Error(`The probe of ${where} does not satisfy the schema of "${tool.name}": ${z.prettifyError(parsed.error)}`);
  }

  const expect = source.probe.expect ?? null;
  if (expect && (expect.field.trim() === "" || !Number.isFinite(expect.atLeast) || expect.detail.trim() === "")) {
    throw new Error(`The probe of ${where} has an expectation without a field, a bound or a reason.`);
  }

  return { tool: tool.name, input: input as Record<string, ProbeValue>, expect };
}

/** `gr/diavgeia` — the registry key and the mount path suffix. */
export function sourceKey(source: Pick<Source, "country" | "id">): string {
  return `${source.country}/${source.id}`;
}

/** Cache lifetime for one tool, falling back to the source default. */
export function ttlFor(meta: SourceMeta, toolName: string): number {
  return meta.ttl[toolName] ?? meta.ttl.default;
}

/** Env vars the source needs that this deployment does not have. */
export function missingEnv(
  meta: SourceMeta,
  env: Readonly<Partial<Record<string, string>>>,
): string[] {
  return (meta.requiresEnv ?? []).filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === "";
  });
}
