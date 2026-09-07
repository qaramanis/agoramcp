/**
 * The questions the mounted sources answer, one page each.
 *
 * A use case is a real question, the prompt that asks it, and the tools that
 * come back with the answer — named as they go over the wire, so the page is
 * checkable against `/all` rather than a story about what the tools might do.
 *
 * Every `tool` here is one a source actually mounts and every `sources` entry
 * has a page at `/all/{country}/{id}`. Adding a use case is an entry in this
 * list; the page renders itself from it.
 */
export type UseCaseStep = {
  /** The tool that answers this step, under its plain (unprefixed) name. */
  tool: string;
  title: string;
  body: string;
};

export type UseCaseSource = {
  /** The id `/all/{country}/{id}` uses. */
  id: string;
  country: string;
  name: string;
};

export type UseCase = {
  slug: string;
  /** The nav row's title and the page's heading. */
  title: string;
  /** The nav row's second line, and the page's description. */
  summary: string;
  blurb: string;
  /** What someone types at their agent, verbatim. */
  prompt: string;
  steps: UseCaseStep[];
  sources: UseCaseSource[];
};

const DIAVGEIA: UseCaseSource = { id: "diavgeia", country: "gr", name: "Diavgeia" };
const KIMDIS: UseCaseSource = { id: "kimdis", country: "gr", name: "KIMDIS" };
const DATAGOV: UseCaseSource = { id: "datagov", country: "gr", name: "data.gov.gr" };
const ATHENS: UseCaseSource = { id: "athens", country: "gr", name: "Dimos Athinaion" };
const MITOS: UseCaseSource = { id: "mitos", country: "gr", name: "Mitos" };

export const useCases: UseCase[] = [
  {
    slug: "public-spending",
    title: "Track public spending",
    summary: "Follow a decision from the body that signed it to the sum it commits",
    blurb:
      "Every act the Greek state signs is published with a unique ADA and a signed PDF. That makes a spending question answerable end to end: which body, which decision, how much, and the document to check it against.",
    prompt:
      "Find the expenditure decisions the Ministry of Health published last month, and total what they commit.",
    steps: [
      {
        tool: "diavgeia_search_organizations",
        title: "Name the body",
        body: "A ministry, a municipality or a hospital is an organization with an id, and the id is what the decision search filters on. Searching the name first is what keeps the rest of the answer about one body.",
      },
      {
        tool: "diavgeia_search_decisions",
        title: "Narrow to the decisions that spend",
        body: "Filter by organization, date range and decision type. Expenditure approvals and commitment decisions are their own types, so the search comes back with the acts that move money rather than every act of the month.",
      },
      {
        tool: "diavgeia_get_decision",
        title: "Read the amounts",
        body: "Each result carries its ADA, the signer, the thematic category and the sums the act commits — enough to add up, group by supplier, or spot the outlier worth opening.",
      },
      {
        tool: "diavgeia_get_decision_text",
        title: "Check it against the document",
        body: "The signed PDF is the record; the fields are an index into it. Pulling the text back is how a figure gets cited rather than asserted.",
      },
    ],
    sources: [DIAVGEIA],
  },
  {
    slug: "procurement",
    title: "Follow a procurement",
    summary: "Notice, award and payment for the same contract, in one thread",
    blurb:
      "Public procurement is published at every step, but the steps sit in separate registers. Asked as one question, the notice that opened a tender, the contract that closed it and the payments that followed line up as a single story.",
    prompt:
      "Show me the contracts my municipality awarded this year over 50,000 euro, and what has actually been paid against them.",
    steps: [
      {
        tool: "kimdis_search_organizations",
        title: "Find the contracting authority",
        body: "The authority is the thread every later step hangs on. One search fixes which municipality, ministry or agency the rest of the answer is about.",
      },
      {
        tool: "kimdis_search_notices",
        title: "Start at the tender",
        body: "The notice says what was asked for, under which procedure and for how much — the estimate an award is later measured against.",
      },
      {
        tool: "kimdis_search_contracts",
        title: "Take the award",
        body: "Who won, for what sum, and under which CPV. Filtering by authority, date and value is the whole of most procurement questions.",
      },
      {
        tool: "kimdis_search_payments",
        title: "Then what was paid",
        body: "An award is a promise; the payment register is what happened. The gap between the two is usually the point of the question.",
      },
    ],
    sources: [KIMDIS, DIAVGEIA],
  },
  {
    slug: "open-data",
    title: "Query an open dataset",
    summary: "Search 22,000 datasets, then read the rows without downloading them",
    blurb:
      "The national catalogue holds datasets from 370 publishers and the City of Athens portal several hundred more. The tabular ones are queryable in place, so a question about the numbers does not begin with a download.",
    prompt:
      "Find a dataset on electric vehicle charging points in Greece and tell me how many there are per region.",
    steps: [
      {
        tool: "datagov_search_datasets",
        title: "Search the catalogue",
        body: "Full text across titles, descriptions and tags, narrowed by publisher, format or licence. What comes back is datasets, each with its publisher and the files it ships.",
      },
      {
        tool: "datagov_get_dataset",
        title: "Read what a dataset holds",
        body: "Its resources, their formats, and the licence it is published under — which decides whether the answer can be republished as well as read.",
      },
      {
        tool: "datagov_query_resource",
        title: "Query the rows in place",
        body: "A tabular resource takes a filter and returns rows. Counting, grouping and filtering happen upstream, so the answer arrives as data rather than as a CSV to open.",
      },
    ],
    sources: [DATAGOV, ATHENS],
  },
  {
    slug: "public-services",
    title: "Look up a public service",
    summary: "The documents, steps and body behind a procedure, as the state defines it",
    blurb:
      "Mitos is the state's own register of what its procedures are: the papers each one asks for, the steps it runs through, the body that owns it and how long it takes. It answers the bureaucratic question directly rather than by reading a circular.",
    prompt:
      "What do I need to register a birth in Greece, and which office does it?",
    steps: [
      {
        tool: "mitos_search_procedures",
        title: "Find the procedure",
        body: "Search by name, or start from a life event — birth, marriage, moving house — where the question is about a moment rather than a form.",
      },
      {
        tool: "mitos_get_procedure",
        title: "Read what it asks for",
        body: "Required documents, the steps in order, the cost, the statutory deadline and the evidence each step consumes, as the register records them.",
      },
      {
        tool: "mitos_get_organization",
        title: "Name the office",
        body: "Procedures belong to bodies. The owning organization is what turns an answer about paperwork into an answer about where to go.",
      },
    ],
    sources: [MITOS],
  },
];

/** Not `useCasePath`: a `useX` function reads as a React hook to the linter. */
export function casePath(slug: string): string {
  return `/use-cases/${slug}`;
}

export function findUseCase(slug: string): UseCase | undefined {
  return useCases.find((useCase) => useCase.slug === slug);
}
