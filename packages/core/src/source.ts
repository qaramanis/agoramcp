import type { z } from "zod";
import type { Cache } from "./cache.ts";
import type { Logger } from "./logger.ts";

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

export interface Source {
  /** Slug, unique within the country: `diavgeia`, `quakes`. */
  id: string;
  /** ISO 3166-1 alpha-2, lowercase: `gr`. */
  country: string;
  meta: SourceMeta;
  tools: readonly AnySourceTool[];
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
  }

  return source;
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
