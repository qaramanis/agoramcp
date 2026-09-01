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
  { title: "Features", dropdown: true, url: "#" },
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

export const features: DropdownItem[] = [
  {
    title: "Typed tool schemas",
    description:
      "Every tool declares its arguments, so models call them correctly",
    url: "#",
    keywords: ["json schema", "input schema"],
  },
  {
    title: "Response caching",
    description: "Per-source TTLs keep upstreams healthy and answers fast",
    url: "#",
    keywords: ["cache"],
  },
  {
    title: "Attribution built in",
    description: "Licence and publisher travel with every response",
    url: "#",
    keywords: ["license"],
  },
  {
    title: "One endpoint per source",
    description: "Connect only to the data you actually need",
    url: "#",
    keywords: ["mount"],
  },
];

/**
 * Resources are grouped by country. Adding a country adds a column here and
 * nothing else — the dropdown widens to fit.
 */
export type CountryGroup = {
  code: string;
  label: string;
  sources: DropdownItem[];
};

export const resourceCountries: CountryGroup[] = [
  {
    code: "docs",
    label: "Docs",
    sources: [
      {
        title: "Documentation",
        description: "Configuration, setup, and user guide",
        url: "#",
      },
    ],
  },
  {
    code: "gr",
    label: "Greece",
    sources: [
      {
        title: "Diavgeia",
        description: "Public spending decisions and procurement",
        url: "/all/gr/diavgeia",
        keywords: ["διαύγεια", "transparency"],
      },
      {
        title: "data.gov.gr",
        description: "National open data catalogue",
        url: "#",
        keywords: ["ckan", "dataset"],
      },
      {
        title: "gov.gr",
        description: "Public services and administrative data",
        url: "#",
      },
    ],
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
