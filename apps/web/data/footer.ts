/**
 * Footer content. Like `menu.ts`, an internal `href` of "#" is a page that does
 * not exist yet. External links point at real destinations.
 */
export type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
  /** Searched, never shown — see `DropdownItem` in `menu.ts`. */
  keywords?: string[];
};

export type FooterColumn = {
  title: string;
  /** Placement on the 12 column grid: two columns wide from md up. */
  className: string;
  links: FooterLink[];
};

export const footerColumns: FooterColumn[] = [
  {
    title: "Product",
    className: "col-span-5 col-start-1 md:col-start-1 md:col-span-2",
    links: [
      { label: "MCP", href: "/mcp" },
      { label: "API", href: "/api" },
      { label: "Dashboard", href: "#" },
      { label: "Quickstart", href: "/quickstart" },
    ],
  },
  {
    title: "Resources",
    className: "col-span-5 col-start-7 md:col-start-3 md:col-span-2",
    links: [
      { label: "Documentation", href: "/documentation" },
      { label: "Status", href: "/status" },
      { label: "Changelog", href: "#" },
      { label: "View live", href: "/live" },
      { label: "Request a country", href: "/country" },
    ],
  },
  {
    title: "Legal",
    className: "col-span-5 col-start-1 md:col-start-5 md:col-span-2",
    links: [
      { label: "Attribution", href: "/licenses#attribution" },
      { label: "Licences", href: "/licenses" },
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  },
];

export const contactLinks: FooterLink[] = [
  {
    label: "hello@agoramcp.eu",
    href: "mailto:hello@agoramcp.eu",
    keywords: ["email", "contact"],
  },
  { label: "GitHub", href: "https://github.com", external: true },
  { label: "X / Twitter", href: "https://x.com", external: true },
];
