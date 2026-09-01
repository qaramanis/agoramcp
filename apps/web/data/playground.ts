/**
 * What the live playground calls, and how it turns a tool into a form.
 *
 * Nothing here names a source. The catalogue is the MCP server's own registry
 * — `data/catalogue.ts` reads it — and every field is derived from the input
 * schema the server publishes for each tool, prefilled from the example the
 * tool declares next to that schema. So a new source, or a new tool on an old
 * one, appears on the page the moment the server mounts it, with nothing to
 * add here.
 *
 * `/api/mcp` validates against the same catalogue: an endpoint the browser
 * asks for has to be one the server lists, or the route would be an open
 * proxy.
 */

export type FieldKind = "text" | "date" | "number" | "boolean" | "choice";

export type ToolField = {
  name: string;
  kind: FieldKind;
  /** Prefilled, so every tool is runnable the moment it is selected. */
  value: string;
  placeholder?: string;
  /** Shown under the request panel: the schema's own description of the field. */
  hint: string;
  /**
   * Optional fields may be left blank, and a blank one is dropped from the
   * request rather than sent empty. Required ones are always sent — including
   * when they are empty, so the server's own validation error is visible.
   */
  optional: boolean;
  /** `value` is what is sent; `label` is a gloss shown next to it, never instead of it. */
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
};

export type PlaygroundTool = {
  name: string;
  title: string;
  /** One line: the first sentence of the tool's own description. */
  summary: string;
  fields: ToolField[];
};

export type PlaygroundProvider = {
  id: string;
  name: string;
  /** Mount path on the MCP server: `/{country}/mcp/{source}`. */
  endpoint: string;
  publisher: string;
  license: string;
  /** A licence condition, not a footnote — it travels with the data. */
  attribution: string;
  upstreamUrl: string;
  tools: PlaygroundTool[];
};

export type PlaygroundCountry = {
  code: string;
  name: string;
  providers: PlaygroundProvider[];
};

/** The part of a tool's JSON Schema the form is built from. */
export type PropertySchema = {
  type?: string;
  description?: string;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

export type InputSchema = {
  properties?: Record<string, PropertySchema>;
  required?: string[];
};

/** How the sources spell a calendar date in their schemas; a match gets a date picker. */
export const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/**
 * One editable field per schema property, in schema order. The kind comes
 * from the property's type, the hint from its description, the starting value
 * from the tool's example — which the server has already checked against the
 * same schema, so a preset is never a value the tool would reject.
 */
export function fieldsFor(schema: InputSchema, example: Record<string, unknown>): ToolField[] {
  const required = new Set(schema.required ?? []);

  return Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const preset = example[name];
    const base = {
      name,
      hint: property.description ?? "",
      optional: !required.has(name),
    };

    if (Array.isArray(property.enum)) {
      const choices = property.enum.map((choice) => ({
        value: String(choice),
        label: String(choice),
      }));
      return {
        ...base,
        kind: "choice" as const,
        value: asValue(preset),
        // A blank choice is how an optional one is left out of the call.
        choices: base.optional ? [{ value: "", label: "unset" }, ...choices] : choices,
      };
    }

    if (property.type === "boolean") {
      return { ...base, kind: "boolean" as const, value: String(preset ?? false) };
    }

    if (property.type === "integer" || property.type === "number") {
      return {
        ...base,
        kind: "number" as const,
        value: asValue(preset),
        ...(property.minimum === undefined ? {} : { min: property.minimum }),
        ...(property.maximum === undefined ? {} : { max: property.maximum }),
      };
    }

    if (property.pattern === DATE_PATTERN) {
      return { ...base, kind: "date" as const, value: asValue(preset) };
    }

    return { ...base, kind: "text" as const, value: asValue(preset) };
  });
}

function asValue(preset: unknown): string {
  return preset === undefined || preset === null ? "" : String(preset);
}

/**
 * The first sentence of a tool description, which is written for a model and
 * runs to a paragraph. Stops at a full stop followed by a capital, and not at
 * an abbreviation's — "e.g. 9ΓΓ346ΝΨ2Ν-Β5Τ" is mid-sentence.
 */
export function firstSentence(text: string): string {
  for (const match of text.matchAll(/\.\s+(?=[A-ZΑ-Ω`"'(])/gu)) {
    const head = text.slice(0, (match.index ?? 0) + 1);
    if (/\b(?:e\.g|i\.e|etc|vs|cf)\.$/u.test(head)) continue;
    return head;
  }
  return text;
}

/** The allow-list `/api/mcp` checks a requested endpoint against. */
export function providerByEndpoint(
  countries: readonly PlaygroundCountry[],
  endpoint: unknown,
): PlaygroundProvider | undefined {
  if (typeof endpoint !== "string") return undefined;
  return countries
    .flatMap((country) => country.providers)
    .find((provider) => provider.endpoint === endpoint);
}

/** The field values a tool starts on, keyed by field name. */
export function defaultValues(tool: PlaygroundTool): Record<string, string> {
  return Object.fromEntries(
    tool.fields.map((field) => [field.name, field.value]),
  );
}

/**
 * The arguments object as it will actually be sent. Blank optional fields are
 * dropped here, which is why the request panel dims them rather than hiding
 * them — what you see is what goes, minus what is greyed out.
 */
export function buildArguments(
  tool: PlaygroundTool,
  values: Record<string, string>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  for (const field of tool.fields) {
    const raw = (values[field.name] ?? "").trim();
    if (raw === "" && field.optional) continue;

    if (field.kind === "number") {
      const parsed = Number(raw);
      // An unparseable number is sent as the string the user typed, so the
      // schema error names the real problem instead of a silent coercion.
      args[field.name] = Number.isFinite(parsed) ? parsed : raw;
    } else if (field.kind === "boolean") {
      args[field.name] = raw === "true";
    } else {
      args[field.name] = raw;
    }
  }

  return args;
}
