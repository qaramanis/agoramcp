import {
  productCards,
  productItems,
  resourceCards,
  resourceItems,
  type DropdownItem,
} from "./menu";

/**
 * Footer content. Every internal `href` is a page; external links point at
 * real destinations.
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

/**
 * A nav row as a footer link. The Product and Resources columns are the nav's
 * own panels, rows then cards, rather than typed out again — so the two
 * cannot drift, and a page added to a panel is in the footer by being there.
 */
function fromMenu(item: DropdownItem): FooterLink {
  return { label: item.title, href: item.url, keywords: item.keywords };
}

export const footerColumns: FooterColumn[] = [
  {
    title: "Product",
    className: "col-span-5 col-start-1 md:col-start-1 md:col-span-2",
    links: [...productItems, ...productCards].map(fromMenu),
  },
  {
    title: "Resources",
    className: "col-span-5 col-start-7 md:col-start-3 md:col-span-2",
    links: [...resourceItems, ...resourceCards].map(fromMenu),
  },
  /**
   * The two pages that are about the service rather than the data, and the
   * code the service runs, which the AGPL-3.0 has it offer to its users. The
   * licences page is under Resources with the rest of the nav, and the
   * attribution band is on it.
   */
  {
    title: "Legal",
    className: "col-span-5 col-start-1 md:col-start-5 md:col-span-2",
    links: [
      { label: "Privacy", href: "/privacy", keywords: ["gdpr", "cookies", "data"] },
      { label: "Terms", href: "/terms", keywords: ["conditions", "legal"] },
      {
        label: "Source code",
        href: "https://github.com/qaramanis/agoramcp/",
        external: true,
        keywords: ["github", "repository", "agpl", "license"],
      },
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
