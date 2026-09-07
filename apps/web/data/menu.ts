import { casePath, useCases } from "./use-cases";

/**
 * Navigation content. A `url` of "#" is a page that does not exist yet, and
 * the nav renders those as inert buttons — only real paths navigate.
 */
export type MenuItem = { title: string; dropdown: boolean; url: string };
/**
 * `keywords` are the terms a person might type that the title and description
 * do not contain — the Greek name, the other spelling, the protocol behind a
 * product name. Searched, never shown.
 */
export type DropdownItem = {
  title: string;
  description: string;
  url: string;
  keywords?: string[];
};
export type IconItem = DropdownItem & { iconColor: string };
/**
 * `image` is a cover photo under /public/cards — Unsplash abstracts, cropped
 * and encoded to WebP. The Unsplash licence needs no attribution; the source
 * photo id sits beside each one so it stays traceable.
 */
export type PanelCard = {
  title: string;
  description: string;
  url: string;
  image: string;
  /** Which part of the photo survives the cover crop; centre unless said. */
  imagePosition?: "bottom";
};

export const menuItems: MenuItem[] = [
  { title: "Product", dropdown: true, url: "#" },
  { title: "Use cases", dropdown: true, url: "#" },
  { title: "Resources", dropdown: true, url: "#" },
];

export const productItems: IconItem[] = [
  {
    title: "MCP",
    description:
      "Connect Claude, Cursor, Codex or any MCP client to official open data",
    url: "/mcp",
    iconColor: "#4ade80",
    keywords: ["model context protocol"],
  },
  {
    title: "API",
    description: "Query our validated sources over plain HTTP",
    url: "/api",
    iconColor: "#86efac",
    keywords: ["rest", "curl"],
  },
  {
    title: "Dashboard",
    description: "Browse sources, tools and usage",
    url: "#",
    iconColor: "#22c55e",
  },
];

export const productCards: PanelCard[] = [
  {
    title: "Quickstart",
    description: "Connected in under a minute",
    url: "/quickstart",
    // images.unsplash.com/photo-1593900154763-1db4833d1784
    image: "/cards/quickstart.webp",
  },
  {
    title: "View live",
    description: "View the tools live in action",
    url: "/live",
    // images.unsplash.com/photo-1728695945232-ba7ccacd55cf
    image: "/cards/live.webp",
  },
];

/**
 * One row per use case, each with a page of its own. Built from
 * `data/use-cases.ts` rather than typed out again, so a row cannot name a page
 * that is not there — and a new use case appears in the nav by being written.
 */
export const useCaseItems: DropdownItem[] = useCases.map((useCase) => ({
  title: useCase.title,
  description: useCase.summary,
  url: casePath(useCase.slug),
}));

/**
 * What you consult while using the sources: how to work them, what changed,
 * whether they are answering, and what the licences ask of you in return.
 */
export const resourceItems: DropdownItem[] = [
  {
    title: "Documentation",
    description: "The vocabulary, the conventions, and which page answers what",
    url: "/documentation",
    keywords: ["docs", "guide"],
  },
  {
    title: "Changelog",
    description: "New sources and tools as they land",
    url: "#",
    keywords: ["releases", "updates"],
  },
  {
    title: "Status",
    description: "Whether each upstream registry is answering",
    url: "/status",
    keywords: ["uptime", "incidents"],
  },
  {
    title: "Licences",
    description: "Every source's licence and the attribution it asks for",
    url: "/licenses",
    keywords: ["license", "attribution", "terms", "reuse"],
  },
];

export const resourceCards: PanelCard[] = [
  {
    title: "View all",
    description: "Every available source in one catalogue",
    url: "/all",
    // images.unsplash.com/photo-1747661380842-9a6d484cde4a
    image: "/cards/all.webp",
  },
  {
    title: "Request a country",
    description: "Want your country supported? Let us know.",
    url: "/country",
    // images.unsplash.com/photo-1747661380937-2b3d9a991523
    image: "/cards/country.webp",
    imagePosition: "bottom",
  },
];
