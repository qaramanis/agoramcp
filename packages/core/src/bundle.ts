import { sourceKey, type AnySourceTool, type Source } from "./source.ts";

/**
 * A country's sources behind one MCP server, mounted at `/{country}/mcp`.
 *
 * A bundle owns no data and no handlers: it is composition over sources that
 * already exist, so nothing here belongs in a source package. The tools it
 * serves are the very same objects the per-source server registers — only the
 * names they are registered under differ.
 */
export interface BundleMeta {
  /** The country, as a person would name it. */
  name: string;
  description: string;
}

export interface Bundle {
  /** ISO 3166-1 alpha-2, lowercase. The mount path is `/{country}/mcp`. */
  country: string;
  meta: BundleMeta;
  sources: readonly Source[];
}

const COUNTRY = /^[a-z]{2}$/;

/**
 * MCP clients cap tool names, and 64 is the shortest cap in common use. A
 * bundle that would exceed it fails at boot rather than at call time.
 */
export const MAX_TOOL_NAME_LENGTH = 64;

/**
 * The prefix a source's tools take inside a bundle. Source ids are kebab-case
 * and tool names snake_case, so the id is folded to snake_case here — a
 * qualified name should read as one convention, not two.
 */
export function toolPrefix(source: Pick<Source, "id">): string {
  return source.id.replaceAll("-", "_");
}

/**
 * `diavgeia_get_decision`. Tool names are only unique within a source, so a
 * bundle has to qualify them: ΓΕΜΗ and Διαύγεια both want `get_organization`.
 *
 * This lives in core rather than the server because the web catalogue has to
 * compute the same names without re-implementing the rule.
 */
export function qualifiedToolName(
  source: Pick<Source, "id">,
  tool: Pick<AnySourceTool, "name">,
): string {
  return `${toolPrefix(source)}_${tool.name}`;
}

/** Validates a bundle at build time, so a collision fails at boot. */
export function defineBundle(bundle: Bundle): Bundle {
  if (!COUNTRY.test(bundle.country)) {
    throw new Error(
      `Bundle country must be a lowercase ISO 3166-1 alpha-2 code, got "${bundle.country}".`,
    );
  }
  if (bundle.sources.length === 0) {
    throw new Error(`Bundle "${bundle.country}" declares no sources.`);
  }

  const seenSources = new Set<string>();
  /** Qualified tool name -> the source that claimed it, for the error message. */
  const claimed = new Map<string, string>();

  for (const source of bundle.sources) {
    if (source.country !== bundle.country) {
      throw new Error(
        `Bundle "${bundle.country}" includes "${sourceKey(source)}", which belongs to another country.`,
      );
    }
    if (seenSources.has(source.id)) {
      throw new Error(`Bundle "${bundle.country}" includes "${source.id}" twice.`);
    }
    seenSources.add(source.id);

    for (const tool of source.tools) {
      const name = qualifiedToolName(source, tool);
      if (name.length > MAX_TOOL_NAME_LENGTH) {
        throw new Error(
          `Tool "${name}" is ${name.length} characters; MCP names stop at ${MAX_TOOL_NAME_LENGTH}. Shorten the source id or the tool name.`,
        );
      }
      const owner = claimed.get(name);
      if (owner) {
        throw new Error(`"${name}" is claimed by both ${owner} and ${sourceKey(source)}.`);
      }
      claimed.set(name, sourceKey(source));
    }
  }

  return bundle;
}
