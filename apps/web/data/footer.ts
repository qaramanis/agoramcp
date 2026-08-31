/**
 * Footer content. Like `menu.ts`, every internal `url` is "#" — the pages don't
 * exist yet. External links point at real destinations.
 */
export type FooterLink = { label: string; href: string; external?: boolean };

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
      { label: "MCP", href: "#" },
      { label: "API", href: "#" },
      { label: "Dashboard", href: "#" },
      { label: "Quickstart", href: "#" },
    ],
  },
  {
    title: "Sources",
    className: "col-span-5 col-start-7 md:col-start-3 md:col-span-2",
    links: [
      { label: "Diavgeia", href: "#" },
      { label: "data.gov.gr", href: "#" },
      { label: "gov.gr", href: "#" },
      { label: "Earthquakes", href: "#" },
    ],
  },
  {
    title: "Resources",
    className: "col-span-5 col-start-1 md:col-start-5 md:col-span-2",
    links: [
      { label: "Documentation", href: "#" },
      { label: "Request a country", href: "#" },
      { label: "Status", href: "#" },
      { label: "Changelog", href: "#" },
    ],
  },
  {
    title: "Legal",
    className: "col-span-5 col-start-7 md:col-start-7 md:col-span-2",
    links: [
      { label: "Attribution", href: "#" },
      { label: "Licences", href: "#" },
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  },
];

export const contactLinks: FooterLink[] = [
  { label: "hello@agoramcp.eu", href: "mailto:hello@agoramcp.eu" },
  { label: "GitHub", href: "https://github.com", external: true },
  { label: "X / Twitter", href: "https://x.com", external: true },
];
