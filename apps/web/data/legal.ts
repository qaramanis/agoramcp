/**
 * The two legal pages, as text. Each is a heading with a lead, the whole
 * thing in a few lines for the panel beside it, and then its sections — the
 * shape of /licenses, the third page of the same kind. One renderer,
 * `components/legal/legal-page.tsx`, draws both.
 *
 * Both say what the code does, not what a template says, and nothing here
 * should outlast the behaviour it describes: change the behaviour, change
 * the text, and move `updated`.
 */

export type LegalSection = {
  title: string;
  /** One string per paragraph. Backticks render as code. */
  body: string[];
  /** The page that goes into it properly, where one does. */
  link?: { label: string; href: string };
};

export type LegalDocument = {
  /** The page heading. */
  heading: string;
  /** Under the heading, one string per paragraph. */
  lead: string[];
  /** The whole document in a few lines, in the panel beside the heading. */
  inShort: string[];
  /** The heading of the band the sections sit in. */
  bandTitle: string;
  sections: LegalSection[];
  /** The day the text last changed, ISO 8601 (`YYYY-MM-DD`). */
  updated: string;
};

/**
 * Read from the code: `db/requester.ts` for what the request form keeps,
 * the server's logging and rate-limit middleware for what a call leaves
 * behind, `packages/core/src/http.ts` for what a registry is sent, and the
 * absence of any cookie, storage or analytics code in the site.
 */
export const privacy: LegalDocument = {
  heading: "What we know about you, which is almost nothing.",
  lead: [
    "agoramcp has no accounts, sets no cookies and runs no analytics. What follows is the whole list of what the site and the servers see when you use them, and what is kept, written from the code, not from a template.",
    "It is short because there is little to say. When the code changes in a way this page describes, the page changes with it and the date below moves.",
  ],
  inShort: [
    "No accounts, no cookies, no analytics, nothing loaded from anyone else.",
    "Requesting a country stores the country and a salted hash of your address and browser, never the address itself.",
    "The servers log one line per request: what was asked, how long it took, and a request id. Not who asked.",
    "The registries see our server, not you.",
  ],
  bandTitle: "Everything, in order.",
  sections: [
    {
      title: "Who this is from",
      body: [
        "agoramcp is run by the person who built it. For the purposes of the GDPR that is the controller of the little this page says is kept, and the address below is where to write about any of it.",
      ],
      link: { label: "hello@agoramcp.eu", href: "mailto:hello@agoramcp.eu" },
    },
    {
      title: "Browsing the site",
      body: [
        "The pages are served by Vercel, which sees your address and browser the way any host does and keeps its own short-lived request logs under its own policy. The site itself sets no cookies, keeps nothing in your browser and loads nothing from anyone else: the fonts are served with the pages, the images are ours, and there is no analytics script.",
      ],
    },
    {
      title: "Requesting a country",
      body: [
        "The one form on the site. Pressing the button stores the country you asked for, the moment you asked, and a SHA-256 hash of your address and browser signature, salted with a secret that never leaves the server. The hash is what lets one person count once per country. It cannot be turned back into an address without the salt, and the address itself is never written down. The row stays for as long as the count is shown.",
      ],
      link: { label: "Request a country", href: "/country" },
    },
    {
      title: "Using the tools",
      body: [
        "Whatever you send to a tool, through an MCP client, the HTTP API or the live playground, goes to our server and on to the registry that holds the answer. The server keeps one structured log line per request: the method and path, the status, how long it took, and the `x-request-id` it also returns to you. It does not log your address, your arguments or what came back.",
        "Your address is held in memory for one minute to enforce the per-source rate limit, and is gone with the minute.",
      ],
      link: { label: "The API and its limits", href: "/api" },
    },
    {
      title: "The registries",
      body: [
        "A registry is called by our server, as our server: it sees our address and a user agent naming agoramcp, not yours. Your arguments reach it as the query they describe, and nothing else travels with them. What a registry keeps of its own traffic is under its own policy.",
      ],
      link: { label: "Every registry, with its publisher", href: "/all" },
    },
    {
      title: "Writing to us",
      body: [
        "Mail to hello@agoramcp.eu is kept to answer it and as the record of the conversation, and is not passed on.",
      ],
    },
    {
      title: "Your rights",
      body: [
        "Under the GDPR you can ask what is held about you, have it corrected or erased, object to its being kept, or take a copy, and complain to your supervisory authority if the answer does not satisfy. Write to hello@agoramcp.eu.",
        "The one thing kept, the hash, is built so that we cannot tell which row is yours. To erase it we would recompute it from the address and browser you used, with your help.",
      ],
    },
    {
      title: "Changes",
      body: [
        "This page describes the code, so it changes when the code does. The date under the heading is the last time that happened.",
      ],
    },
  ],
  updated: "2026-09-12",
};

export const terms: LegalDocument = {
  heading: "Plain terms for a plain service.",
  lead: [
    "agoramcp puts official public registries behind MCP servers and an HTTP API, and this site describes them. Using any of the three means agreeing to what follows, which is mostly a statement of where the data comes from and how much of it is ours, which is none.",
    "They are short for the same reason the privacy page is: there is not much to govern.",
  ],
  inShort: [
    "The data is the registries', under their licences. Their conditions are yours to meet.",
    "The service is offered as it is, with no promise that a registry is answering or a record is right.",
    "There is a per-source rate limit, and no working around it.",
    "Governed by Greek law.",
  ],
  bandTitle: "The terms.",
  sections: [
    {
      title: "What the service is",
      body: [
        "MCP servers and an HTTP API that adapt public registries (Diavgeia, data.gov.gr and the rest of the catalogue) so that a model or a script can query them. Nothing is stored or curated: every answer is fetched from the registry when asked for, and returned as published.",
      ],
      link: { label: "The catalogue", href: "/all" },
    },
    {
      title: "Whose data it is",
      body: [
        "Every record belongs to the body that publishes it and comes under that body's licence. agoramcp adds no condition on top and claims nothing over the data. The licence and the attribution line arrive with every answer, and meeting them (showing the line, keeping to what the licence permits) is your responsibility, not ours. Some registries record no licence at all; what that means for reuse is on the licences page.",
      ],
      link: { label: "Licences", href: "/licenses" },
    },
    {
      title: "No warranty",
      body: [
        "The service is provided as it is and as available. A registry can be down, slow or wrong, and its records come back exactly as it published them, unverified. Nothing here is legal, financial or professional advice, and a record found through agoramcp is not an official copy of it. For that, go to the registry.",
      ],
    },
    {
      title: "Availability and limits",
      body: [
        "There is no service level. Each source has a per-minute budget per caller; a request over it is refused with a `429` and told when to try again, and the numbers are on the API page. The status page says what is answering now. The service may change or stop, in whole or in part, without notice; the changelog is where changes are written down.",
      ],
      link: { label: "The API and its limits", href: "/api" },
    },
    {
      title: "What not to do",
      body: [
        "Do not work around the rate limit, or route traffic so that one caller looks like many. Do not use the service to attack, scrape or overload a registry; they are public bodies' servers, and agoramcp exists to be a considerate caller of them. Do not present what comes back as agoramcp's own, or as an official document. And keep to the registry's own terms, which the service cannot enforce for you.",
      ],
    },
    {
      title: "Liability",
      body: [
        "To the extent the law allows, agoramcp is not liable for loss that comes from using the service, from its being unavailable, or from acting on a record it returned. The registry that published the record is the authority on it; this service is a way of asking.",
      ],
    },
    {
      title: "Changes to these terms",
      body: [
        "These terms may change; the date under the heading is the last time they did. Using the service after a change is agreeing to it.",
      ],
    },
    {
      title: "Governing law",
      body: [
        "These terms are governed by the law of Greece. Anything they do not settle, write to us about first.",
      ],
      link: { label: "hello@agoramcp.eu", href: "mailto:hello@agoramcp.eu" },
    },
  ],
  updated: "2026-09-12",
};
