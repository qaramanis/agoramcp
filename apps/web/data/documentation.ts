/**
 * What the documentation page is made of.
 *
 * The page is a map and a vocabulary, and deliberately nothing else: how the
 * servers work is /mcp's, the HTTP contract is /api's, connecting is
 * /quickstart's and the tools themselves are the catalogue's. What no other
 * page owns is the words this site uses, the rules that hold across all of
 * them, and a straight answer to "which page answers my question" — so those
 * three are what lives here.
 */

export type Term = {
  term: string;
  definition: string;
  /** The page that goes into it properly, where one does. */
  where?: { label: string; href: string };
};

/**
 * The nouns the rest of the site uses without stopping to define them. Each
 * one is defined once, here, and points at the page that uses it in anger.
 */
export const glossary: Term[] = [
  {
    term: "Source",
    definition:
      "One official registry, adapted: its own tools, its own publisher, its own licence. A source is the smallest thing you can point a client at.",
    where: { label: "The catalogue", href: "/all" },
  },
  {
    term: "Country server",
    definition:
      "Every source a country mounts, behind one address. Reach for it before you know which registry holds the answer; reach for a single source when you already do.",
    where: { label: "MCP", href: "/mcp" },
  },
  {
    term: "Tool",
    definition:
      "One question a source can answer, with typed arguments and a description written for a model to read. A tool is what a client calls and what an HTTP request addresses.",
    where: { label: "The catalogue", href: "/all" },
  },
  {
    term: "Prefix",
    definition:
      "What a country server puts in front of a tool name so two registries can both have a `search_organizations`, as in `diavgeia_search_organizations`. On a source's own server the tools keep their plain names.",
    where: { label: "MCP", href: "/mcp" },
  },
  {
    term: "Envelope",
    definition:
      "What an HTTP response wraps around `data`, the tool's own result: which source and tool answered, and the provenance that has to travel with the data.",
    where: { label: "API", href: "/api" },
  },
  {
    term: "Attribution",
    definition:
      "The line the publisher asks you to show wherever you show their data. It is a condition of the licence, not a courtesy, and it arrives with every answer.",
    where: { label: "Licences", href: "/licenses" },
  },
  {
    term: "ADA",
    definition:
      "The code every act published under the Greek Transparency Programme carries, unique to that act. Given one, you can fetch the record, its signed PDF and its history.",
    where: { label: "Diavgeia", href: "/all/gr/diavgeia" },
  },
  {
    term: "ADAM",
    definition:
      "The procurement equivalent: the code that identifies one document in the public contracts registry (a request, a notice, a contract or a payment order).",
    where: { label: "KIMDIS", href: "/all/gr/kimdis" },
  },
];

export type Convention = { title: string; body: string };

/**
 * The rules that hold everywhere, so no page has to restate them. Each one is
 * a fact about the whole system rather than about the page it turns up on.
 */
export const conventions: Convention[] = [
  {
    title: "Country, then source, then tool",
    body: "Every address is built the same way and in that order: `/gr/mcp` is a country, `/gr/mcp/diavgeia` is one of its sources, `/gr/api/diavgeia/search_decisions` is one of that source's tools. Countries are ISO 3166-1 alpha-2, lowercased.",
  },
  {
    title: "Tool names are a verb and a noun",
    body: "`search_` takes a question and returns matches, `get_` takes an identifier and returns one record, `list_` returns a fixed set with no question to ask. A name tells you which of the three you are about to do before you read its arguments.",
  },
  {
    title: "Dates are YYYY-MM-DD",
    body: "In every date argument and every date in a record, no exceptions and no locale. Ranges are two arguments rather than one string.",
  },
  {
    title: "Greek is transliterated here, never in the data",
    body: "Names are written in Latin script on this site because a reader without Greek should still be able to say them. The records themselves are untouched: a subject, a body's name or an attribution line comes back exactly as the registry wrote it.",
  },
];

export type Route = {
  title: string;
  href: string;
  /** The question this page is the answer to. */
  answers: string;
  /** What it deliberately does not cover, and where that lives instead. */
  boundary: string;
};

/**
 * The map. Every page has one job, and the second half of each row says which
 * job is not its — which is what keeps the site from explaining the same thing
 * in four places.
 */
export const routes: Route[] = [
  {
    title: "Quickstart",
    href: "/quickstart",
    answers: "How do I get my client talking to it?",
    boundary: "The command or config entry per client, and nothing about what happens afterwards.",
  },
  {
    title: "MCP",
    href: "/mcp",
    answers: "What are these servers, and what happens on a call?",
    boundary: "The addresses and the request lifecycle, not the snippets, which are the quickstart's.",
  },
  {
    title: "API",
    href: "/api",
    answers: "How do I call a tool without an agent?",
    boundary: "The HTTP contract end to end: addresses, arguments, the envelope, the error codes and the limits.",
  },
  {
    title: "Live",
    href: "/live",
    answers: "What does a real answer actually look like?",
    boundary: "One call at a time, with arguments you edit: the response, not the contract around it.",
  },
  {
    title: "All sources",
    href: "/all",
    answers: "What can I ask, and of which registry?",
    boundary: "Every country, source and tool, each with its arguments and the example it ships with.",
  },
  {
    title: "Use cases",
    href: "/use-cases/public-spending",
    answers: "What does a whole question look like?",
    boundary: "Four worked examples and the path of tools each takes. Illustrations, not reference.",
  },
  {
    title: "Changelog",
    href: "/changelog",
    answers: "What changed, and when?",
    boundary:
      "Every commit in the repository, newest first, each with the version it landed at.",
  },
  {
    title: "Status",
    href: "/status",
    answers: "Is it answering right now?",
    boundary: "A live check per registry, and how long each one took.",
  },
  {
    title: "Licences",
    href: "/licenses",
    answers: "What may I do with the data?",
    boundary: "What each licence asks of you, and the exact line to credit each publisher with.",
  },
];
