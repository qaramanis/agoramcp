import { MCP_BASE_URL } from "./mcp";

/**
 * The HTTP API's addresses and the snippets the /api page prints. Built on the
 * same base URL as the MCP snippets, so deploying the server changes the host
 * in one place. The shapes here mirror `apps/server/src/api.ts`; the responses
 * were captured from the running server and trimmed — the envelope is the
 * server's, the records are Διαύγεια's.
 */

/** The address shape, placeholders in braces — the MCP mount's plus the tool. */
export const API_PATTERN = "/{country}/api/{source}/{tool}";

export function apiUrl(path: string): string {
  return `${MCP_BASE_URL}${path}`;
}

/**
 * The first request: one act by its ΑΔΑ, the example `get_decision` ships
 * with. `-G --data-urlencode` rather than a literal `?ada=`: the ΑΔΑ is Greek,
 * a query string is ASCII, and curl sends a URL exactly as typed where every
 * HTTP library encodes for you.
 */
export const FIRST_REQUEST = [
  `curl -G --data-urlencode 'ada=9ΓΓ346ΝΨ2Ν-Β5Τ' \\`,
  `  ${apiUrl("/gr/api/diavgeia/get_decision")}`,
].join("\n");

export const FIRST_RESPONSE = `{
  "source": "diavgeia",
  "country": "gr",
  "tool": "get_decision",
  "publisher": "Υπουργείο Ψηφιακής Διακυβέρνησης — Πρόγραμμα ΔΙΑΥΓΕΙΑ",
  "license": "CC-BY-4.0",
  "attribution": "Πρόγραμμα ΔΙΑΥΓΕΙΑ (diavgeia.gov.gr)",
  "upstreamUrl": "https://diavgeia.gov.gr/opendata",
  "data": {
    "ada": "9ΓΓ346ΝΨ2Ν-Β5Τ",
    "subject": "Μισθοδοσία μηνός Αυγούστου 2026",
    "issuedOn": "2026-08-29",
    "status": "PUBLISHED",
    "organization": {
      "id": "100076956",
      "name": "ΑΝΑΠΤΥΞΙΑΚΟΣ ΟΡΓΑΝΙΣΜΟΣ ΔΗΜΟΥ ΛΑΡΙΣΑΙΩΝ ΜΟΝΟΠΡΟΣΩΠΗ Α Ε"
    },
    "expenses": { "totals": [{ "currency": "EUR", "amount": 2087.86 }] },
    "documentUrl": "https://diavgeia.gov.gr/doc/9ΓΓ346ΝΨ2Ν-Β5Τ",
    …
  }
}`;

/** The country index: every source, and where each of its tools answers. */
export const DISCOVER_REQUEST = `curl ${apiUrl("/gr/api")}`;

export const DISCOVER_RESPONSE = `{
  "country": "gr",
  "endpoint": "/gr/api",
  "sources": [
    {
      "id": "diavgeia",
      "name": "Διαύγεια",
      "license": "CC-BY-4.0",
      "attribution": "Πρόγραμμα ΔΙΑΥΓΕΙΑ (diavgeia.gov.gr)",
      "endpoint": "/gr/api/diavgeia",
      "tools": [
        { "name": "search_decisions", "endpoint": "/gr/api/diavgeia/search_decisions", … },
        { "name": "get_decision", "endpoint": "/gr/api/diavgeia/get_decision", … },
        …
      ]
    },
    …
  ]
}`;

/** The same search, once as a query string and once as a body. */
export const GET_REQUEST = [
  `curl -G ${apiUrl("/gr/api/diavgeia/search_decisions")} \\`,
  `  --data-urlencode 'subject=προμήθεια' \\`,
  `  --data-urlencode 'issuedFrom=2026-01-01' \\`,
  `  --data-urlencode 'issuedTo=2026-01-31' \\`,
  `  --data-urlencode 'size=5'`,
].join("\n");

export const POST_REQUEST = [
  `curl ${apiUrl("/gr/api/diavgeia/search_decisions")} \\`,
  `  -H 'content-type: application/json' \\`,
  `  -d '{ "subject": "προμήθεια", "issuedFrom": "2026-01-01", "issuedTo": "2026-01-31", "size": 5 }'`,
].join("\n");

/** What the envelope carries around `data`, in the order it arrives. */
export const ENVELOPE: { key: string; meaning: string }[] = [
  { key: "source", meaning: "the source id, as in the address" },
  { key: "country", meaning: "its ISO 3166-1 alpha-2 code" },
  { key: "tool", meaning: "the tool that answered" },
  { key: "publisher", meaning: "the body that publishes the registry" },
  { key: "license", meaning: "the registry's licence, SPDX where one exists" },
  { key: "attribution", meaning: "the line the licence asks you to show with the data" },
  { key: "upstreamUrl", meaning: "where the registry itself lives" },
  { key: "data", meaning: "the tool's own result — what an assistant reads over MCP" },
];

/** A real 400, as the server sent it for `?ada=INVALID`. */
export const ERROR_STATUS = "HTTP/1.1 400 Bad Request";

export const ERROR_RESPONSE = `{
  "error": {
    "code": "invalid_input",
    "message": "✖ An ΑΔΑ looks like 9ΓΓ346ΝΨ2Ν-Β5Τ: capitals and digits, a hyphen, then three characters.\\n  → at ada",
    "retryable": false,
    "details": {
      "issues": [{ "path": "ada", "message": "An ΑΔΑ looks like 9ΓΓ346ΝΨ2Ν-Β5Τ: …" }]
    }
  }
}`;

/**
 * Every `code` the API sends and the status it comes with. The vocabulary is
 * `packages/core/src/errors.ts`; the 405 is the API's own, for verbs other
 * than GET and POST.
 */
export const ERROR_CODES: { code: string; status: number; meaning: string }[] = [
  { code: "invalid_input", status: 400, meaning: "an argument is missing, malformed, or not one the tool declares" },
  { code: "not_found", status: 404, meaning: "no such source, tool or record" },
  { code: "method_not_allowed", status: 405, meaning: "only GET and POST" },
  { code: "rate_limited", status: 429, meaning: "over the per-source budget for this minute" },
  { code: "internal", status: 500, meaning: "something else; the message says what" },
  { code: "upstream_error", status: 502, meaning: "the registry answered with something unusable" },
  { code: "upstream_unavailable", status: 503, meaning: "the registry is down; try again" },
  { code: "missing_credentials", status: 503, meaning: "this deployment lacks a token the source needs" },
  { code: "upstream_timeout", status: 504, meaning: "the registry did not answer in time" },
];

/**
 * The server's default (`RATE_LIMIT_PER_MINUTE` in `apps/server/src/config.ts`).
 * The page states it rather than reading it: the two apps deploy separately.
 */
export const RATE_LIMIT_PER_MINUTE = 60;
