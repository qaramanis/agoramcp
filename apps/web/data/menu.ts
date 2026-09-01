/**
 * Navigation content. A `url` of "#" is a page that does not exist yet, and
 * the nav renders those as inert buttons — only real paths navigate.
 */
export type MenuItem = { title: string; dropdown: boolean; url: string };
export type DropdownItem = { title: string; description: string; url: string };
export type IconItem = DropdownItem & { iconColor: string };
export type PanelCard = { title: string; description: string; url: string };

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
  },
  {
    title: "API",
    description: "Query our valdidated sources over plain HTTP",
    url: "#",
    iconColor: "#86efac",
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
  },
  {
    title: "View live",
    description: "View the tools live in action",
    url: "/live",
  },
];

export const features: DropdownItem[] = [
  {
    title: "Typed tool schemas",
    description:
      "Every tool declares its arguments, so models call them correctly",
    url: "#",
  },
  {
    title: "Response caching",
    description: "Per-source TTLs keep upstreams healthy and answers fast",
    url: "#",
  },
  {
    title: "Attribution built in",
    description: "Licence and publisher travel with every response",
    url: "#",
  },
  {
    title: "One endpoint per source",
    description: "Connect only to the data you actually need",
    url: "#",
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
    code: "gr",
    label: "Greece",
    sources: [
      {
        title: "Diavgeia",
        description: "Public spending decisions and procurement",
        url: "#",
      },
      {
        title: "data.gov.gr",
        description: "National open data catalogue",
        url: "#",
      },
      {
        title: "gov.gr",
        description: "Public services and administrative data",
        url: "#",
      },
    ],
  },
  {
    code: "all",
    label: "All",
    sources: [
      {
        title: "View all",
        description: "Every source across every country in one catalogue",
        url: "#",
      },
    ],
  },
];

export const resourceCards: PanelCard[] = [
  {
    title: "Documentation",
    description: "Configuration, setup, and user guide",
    url: "#",
  },
  {
    title: "Request a country",
    description: "Want your country supported? Let us know!",
    url: "/country",
  },
];
