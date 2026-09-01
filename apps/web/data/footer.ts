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
  /**
   * A second column of links, for a group too long for one. From md up it gets
   * its own grid column at `moreClassName`. Below md the grid is only two wide,
   * where a headless column would land under an unrelated one and read as part
   * of it, so these stay in the parent column instead.
   */
  moreLinks?: FooterLink[];
  moreClassName?: string;
};

export const footerColumns: FooterColumn[] = [
  {
    title: "Product",
    className: "col-span-5 col-start-1 md:col-start-1 md:col-span-2",
    links: [
      { label: "MCP", href: "/mcp" },
      { label: "API", href: "#" },
      { label: "Dashboard", href: "#" },
      { label: "Quickstart", href: "/quickstart" },
    ],
  },
  {
    title: "Resources",
    className: "col-span-5 col-start-7 md:col-start-3 md:col-span-2",
    links: [
      { label: "Documentation", href: "#" },
      { label: "Status", href: "#" },
      { label: "Changelog", href: "#" },
    ],
    // The two resources that are actually live, kept together in the second
    // column rather than mixed in with the pages that do not exist yet.
    moreLinks: [
      { label: "View live", href: "/live" },
      { label: "Request a country", href: "/country" },
    ],
    moreClassName: "hidden md:col-start-5 md:col-span-2 md:flex",
  },
  {
    title: "Legal",
    className: "col-span-5 col-start-1 md:col-start-7 md:col-span-2",
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
