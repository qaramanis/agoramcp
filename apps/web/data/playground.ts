/**
 * What the live playground is allowed to call.
 *
 * One entry per mounted MCP endpoint. The page renders whatever it finds here,
 * so a new source is added by appending to this file and nothing else — the
 * same bargain `apps/server/src/registry.ts` makes on the server side.
 *
 * `/api/mcp` validates against this catalogue too: an endpoint the browser asks
 * for has to already be listed, or the route would be an open proxy.
 *
 * Every default is a fixed literal, never anything derived from `new Date()`.
 * The panels are server-rendered first and a value that differs between server
 * and client is a hydration mismatch.
 */

export type FieldKind = "text" | "date" | "number" | "boolean" | "choice";

export type ToolField = {
  name: string;
  kind: FieldKind;
  /** Prefilled, so every tool is runnable the moment it is selected. */
  value: string;
  placeholder?: string;
  /** Shown under the request panel. Plain English, no jargon. */
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
  /** One line, in the same register as DOCUMENTATION.md's "In plain terms". */
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

/**
 * Διαύγεια's own type codes. The register labels them in Greek; the label here
 * is our gloss, shown beside the code rather than in place of it — the request
 * pane has to keep showing the value that actually goes over the wire.
 */
const DECISION_TYPES: { value: string; label: string }[] = [
  { value: "", label: "Any type" },
  { value: "Β.2.2", label: "Payment finalised" },
  { value: "Β.2.1", label: "Expenditure approved" },
  { value: "Β.1.3", label: "Funds committed" },
  { value: "Δ.1", label: "Contract award" },
  { value: "Δ.2.2", label: "Tender awarded" },
  { value: "Γ.3.4", label: "Contract signed" },
  { value: "Γ.3.3", label: "Appointment" },
  { value: "Β.4", label: "Grant or donation" },
  { value: "Α.2", label: "Regulatory act" },
];

const diavgeia: PlaygroundProvider = {
  id: "diavgeia",
  name: "Diavgeia",
  endpoint: "/gr/mcp/diavgeia",
  publisher: "Ypourgeio Psifiakis Diakyvernisis — Programma DIAVGEIA",
  license: "CC-BY-4.0",
  attribution: "Programma DIAVGEIA (diavgeia.gov.gr)",
  upstreamUrl: "https://diavgeia.gov.gr/opendata",
  tools: [
    {
      name: "search_decisions",
      title: "Search decisions for keywords, date ranges, and specific types",
      summary:
        "Find administrative acts by topic, kind and date — each one with its subject, the body that issued it, any money it declares and a link to the signed PDF.",
      fields: [
        {
          name: "subject",
          kind: "text",
          value: "προμήθεια",
          placeholder: "subject line",
          hint: "Matches the act's subject line only. Diavgeia is indexed in Greek, so a Greek word matches far more than an English one.",
          optional: true,
        },
        {
          name: "text",
          kind: "text",
          value: "",
          placeholder: "any word",
          hint: "Free-text search across the whole record, not just the subject. Wider and noisier than `subject`.",
          optional: true,
        },
        {
          name: "decisionType",
          kind: "choice",
          value: "",
          hint: "Narrows to one kind of act. Financial types are the ones that carry an amount.",
          optional: true,
          choices: DECISION_TYPES,
        },
        {
          name: "issuedFrom",
          kind: "date",
          value: "2025-01-01",
          hint: "Earliest issue date. Leave this out and Diavgeia searches only the last six months — the archive runs back to 2010.",
          optional: true,
        },
        {
          name: "issuedTo",
          kind: "date",
          value: "2025-01-31",
          hint: "Latest issue date, inclusive.",
          optional: true,
        },
        {
          name: "size",
          kind: "number",
          value: "5",
          hint: "Acts per page, 1 to 100.",
          optional: true,
          min: 1,
          max: 100,
        },
        {
          name: "page",
          kind: "number",
          value: "0",
          hint: "Zero-based page number. `total` in the response says how many pages there are to walk.",
          optional: true,
          min: 0,
        },
      ],
    },
    {
      name: "get_decision",
      title: "Get all available information for a decision",
      summary:
        "Pull the full record for a single act, given the ADA — the code Diavgeia stamps on it at publication and that Greek paperwork and news reports quote.",
      fields: [
        {
          name: "ada",
          kind: "text",
          value: "ΨΥ8ΟΟΡΙΕ-0ΔΗ",
          placeholder: "9ΓΓ346ΝΨ2Ν-Β5Τ",
          hint: "Capitals and digits, a hyphen, then three characters. A malformed one is rejected before any request leaves the server.",
          optional: false,
        },
      ],
    },
    {
      name: "list_decision_types",
      title: "List available decision types",
      summary:
        "Read the controlled vocabulary of act types. These codes are the only valid values for the type filter on a search, so this is the call that comes first.",
      fields: [
        {
          name: "includeGroups",
          kind: "boolean",
          value: "false",
          hint: "Parent groups only organise the list — they cannot be assigned to an act. Off by default.",
          optional: true,
        },
      ],
    },
    {
      name: "search_organizations",
      title: "Find a public body by name",
      summary:
        "Turn the name of a ministry, municipality or hospital into the numeric id every other filter needs. Accents and case are ignored, so 'Kalamatas' and 'KALAMATAS' find the same body.",
      fields: [
        {
          name: "query",
          kind: "text",
          value: "δημος αθηναιων",
          placeholder: "part of the body's name, or its VAT number",
          hint: "Matched against the body's Greek name. Type it however you like — accents, case and the final sigma are all folded away.",
          optional: false,
        },
        {
          name: "category",
          kind: "text",
          value: "",
          placeholder: "MINISTRY, NPDD, MUNICIPALITY…",
          hint: "Narrows to one kind of body. Leave blank to search all 5,400 of them.",
          optional: true,
        },
        {
          name: "limit",
          kind: "number",
          value: "5",
          hint: "How many matches to return, 1-100.",
          optional: true,
          min: 1,
          max: 100,
        },
      ],
    },
    {
      name: "get_organization",
      title: "Get a public body's register entry",
      summary:
        "The full register record for one body: official name, VAT number, website, the body that supervises it, and the Government Gazette issue that created it.",
      fields: [
        {
          name: "organizationId",
          kind: "text",
          value: "99221912",
          placeholder: "99221912",
          hint: "The numeric id, from a search result's organization.id or from search_organizations.",
          optional: false,
        },
      ],
    },
    {
      name: "list_organization_units",
      title: "List a body's departments",
      summary:
        "The directorates and departments inside one body, each with the id that narrows a search from a whole ministry to a single office within it.",
      fields: [
        {
          name: "organizationId",
          kind: "text",
          value: "99221912",
          placeholder: "99221912",
          hint: "The body whose internal structure to list.",
          optional: false,
        },
        {
          name: "includeInactive",
          kind: "boolean",
          value: "false",
          hint: "Dissolved and merged units still appear on the older acts they signed. Off by default.",
          optional: true,
        },
      ],
    },
    {
      name: "get_signer",
      title: "Get the official who signed an act",
      summary:
        "Resolve a signer id into a person — their name, the body they work for and the post they hold. A decision names its signers only by number; this is what turns that into an answer.",
      fields: [
        {
          name: "signerId",
          kind: "text",
          value: "100090423",
          placeholder: "100090423",
          hint: "One of the signerIds listed on a decision.",
          optional: false,
        },
      ],
    },
    {
      name: "list_thematic_categories",
      title: "List available thematic categories",
      summary:
        "The subject areas an act can be filed under — health, transport, public finance. A category says what an act is about, where a type says what kind of act it is.",
      fields: [],
    },
  ],
};

export const countries: PlaygroundCountry[] = [
  { code: "gr", name: "Greece", providers: [diavgeia] },
];

export function findCountry(code: string): PlaygroundCountry | undefined {
  return countries.find((country) => country.code === code);
}

export function findProvider(
  countryCode: string,
  providerId: string,
): PlaygroundProvider | undefined {
  return findCountry(countryCode)?.providers.find(
    (provider) => provider.id === providerId,
  );
}

/** The allow-list `/api/mcp` checks a requested endpoint against. */
export function providerByEndpoint(
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
