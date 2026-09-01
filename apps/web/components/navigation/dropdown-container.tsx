"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Code2, LayoutDashboard, Server } from "lucide-react";
import {
  features,
  productCards,
  productItems,
  resourceCards,
  resourceCountries,
} from "@/data/menu";
import { MIN_QUERY, searchContent } from "@/data/search";

const productIcons = [Server, Code2, LayoutDashboard];

export type DropdownType =
  "product" | "features" | "resources" | "search" | null;

interface DropdownContainerProps {
  activeDropdown: DropdownType;
  /** Re-measured on every keystroke, so the panel morphs as results change. */
  searchQuery: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onItemClick: (href: string) => void;
}

export default function DropdownContainer({
  activeDropdown,
  searchQuery,
  onMouseEnter,
  onMouseLeave,
  onItemClick,
}: DropdownContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!activeDropdown) {
      // Closing — drop the inline sizes so Tailwind owns opacity/transform.
      dimensionsRef.current = { width: 0, height: 0 };
      container.style.removeProperty("width");
      container.style.removeProperty("height");
      container.style.removeProperty("transition");
      return;
    }

    // Where the panel is coming from (the previously open dropdown).
    const startWidth = dimensionsRef.current.width;
    const startHeight = dimensionsRef.current.height;

    // Let the new content size itself so we can measure its natural box.
    container.style.transition = "none";
    container.style.width = "auto";
    container.style.height = "auto";

    const targetWidth = container.offsetWidth;
    const targetHeight = container.offsetHeight;

    dimensionsRef.current = { width: targetWidth, height: targetHeight };

    if (startWidth > 0 && startHeight > 0) {
      // Switching panels: snap back to the old box, then morph to the new one.
      container.style.width = `${startWidth}px`;
      container.style.height = `${startHeight}px`;

      // Force a reflow so the browser treats the old box as the start frame.
      void container.offsetHeight;

      container.style.transition =
        "width 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, transform 0.3s ease";
      container.style.width = `${targetWidth}px`;
      container.style.height = `${targetHeight}px`;
    } else {
      // First open: nothing to morph from, so just adopt the measured size.
      container.style.width = `${targetWidth}px`;
      container.style.height = `${targetHeight}px`;
      container.style.transition = "opacity 0.4s ease, transform 0.3s ease";
    }

    const contentEl = container.querySelector(
      ".dropdown-content",
    ) as HTMLElement | null;
    if (contentEl) {
      contentEl.style.opacity = "0";
      requestAnimationFrame(() => {
        contentEl.style.transition = "opacity 0.6s ease";
        contentEl.style.opacity = "1";
      });
    }
  }, [activeDropdown, searchQuery]);

  return (
    <div
      ref={containerRef}
      className={`fixed top-16 left-1/2 z-100 hidden w-auto overflow-hidden rounded-md border border-panel-border bg-panel md:block ${
        activeDropdown
          ? "pointer-events-auto -translate-x-1/2 translate-y-0 opacity-100"
          : "pointer-events-none -translate-x-1/2 -translate-y-2 opacity-0"
      }`}
      style={{ transition: "opacity 0.3s ease, transform 0.3s ease" }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {activeDropdown === "product" && (
        <div className="dropdown-content flex w-[620px]">
          <div className="flex-1 p-2">
            <div className="flex flex-col gap-0.5">
              {productItems.map((item, index) => {
                const Icon = productIcons[index] ?? Server;
                return (
                  <PanelRow
                    key={item.title}
                    item={item}
                    onClick={onItemClick}
                    className="p-3"
                    icon={<Icon size={16} color={item.iconColor} />}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2 p-2 pl-0">
            {productCards.map((card) => (
              <PanelCardButton
                key={card.title}
                card={card}
                onClick={onItemClick}
              />
            ))}
          </div>
        </div>
      )}

      {activeDropdown === "features" && (
        <div className="dropdown-content w-[440px] p-2">
          <div className="flex flex-col gap-0.5">
            {features.map((item) => (
              <PanelRow key={item.title} item={item} onClick={onItemClick} />
            ))}
          </div>
        </div>
      )}

      {activeDropdown === "search" && (
        <div className="dropdown-content w-[480px] p-2">
          <SearchResults query={searchQuery} onItemClick={onItemClick} />
        </div>
      )}

      {activeDropdown === "resources" && (
        <div className="dropdown-content flex w-[740px]">
          {/* One column: the group labels do the separating, not the layout. */}
          <div className="flex-1 p-2">
            {resourceCountries.map((country) => (
              <div key={country.code}>
                <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-medium tracking-wider text-muted uppercase">
                  {country.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {country.sources.map((item) => (
                    <PanelRow
                      key={item.title}
                      item={item}
                      onClick={onItemClick}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-1 flex-col gap-2 p-2 pl-0">
            {resourceCards.map((card) => (
              <PanelCardButton
                key={card.title}
                card={card}
                onClick={onItemClick}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One title/description row, shared by the product, features, resources and
 * search lists.
 *
 * Same bargain as PanelCardButton: a row whose page exists is a real link, so
 * it can be middle-clicked and opened in a new tab, and a row that still
 * points at "#" stays a button that only closes the panel.
 */
function PanelRow({
  item,
  onClick,
  icon,
  className = "p-2.5",
}: {
  item: { title: string; description: string; url: string };
  onClick: (href: string) => void;
  /** Only the product panel has icons; the other lists are titles alone. */
  icon?: ReactNode;
  className?: string;
}) {
  const rowClass = `group cursor-pointer rounded-md text-left transition-all duration-300 hover:bg-background ${className}`;

  const title = (
    <span className="text-[13px] font-semibold tracking-wide text-foreground transition-colors duration-300 group-hover:text-accent">
      {item.title}
    </span>
  );

  const content = (
    <>
      {icon ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0">{icon}</span>
          {title}
        </div>
      ) : (
        title
      )}
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        {item.description}
      </span>
    </>
  );

  if (item.url === "#") {
    return (
      <button onClick={() => onClick(item.url)} className={rowClass}>
        {content}
      </button>
    );
  }

  return (
    <Link
      href={item.url}
      onClick={() => onClick(item.url)}
      className={rowClass}
    >
      {content}
    </Link>
  );
}

/**
 * Bloom uses cover images here and so do we: an abstract under a bottom-up
 * shade that keeps the copy readable, with the hover of the source squares on
 * the landing page — grey border turning accent.
 *
 * A card whose page exists is a real link — right-clickable, openable in a new
 * tab. The rest stay buttons that only close the panel, because a placeholder
 * that looks navigable is worse than one that plainly is not.
 */
function PanelCardButton({
  card,
  onClick,
}: {
  card: {
    title: string;
    description: string;
    url: string;
    image: string;
    imagePosition?: "bottom";
  };
  onClick: (href: string) => void;
}) {
  // bg-background shows only until the image has loaded.
  const className =
    "group relative flex-1 cursor-pointer overflow-hidden rounded-md border border-panel-border bg-background text-left transition-colors duration-300 hover:border-accent/50";

  const content = (
    <>
      {/* Pre-cropped and encoded, so there is nothing for Next to optimise. */}
      <Image
        src={card.image}
        alt=""
        fill
        unoptimized
        className={`object-cover ${
          card.imagePosition === "bottom" ? "object-bottom" : ""
        }`}
      />
      {/* Dim and soften the whole photo, heaviest at the bottom where the
          copy sits; backdrop-blur so the blur cannot bleed past the edges. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 via-60% to-black/30 backdrop-blur-[1px]" />
      <div className="relative flex h-full min-h-[80px] flex-col justify-end p-4">
        <p className="text-[13px] font-semibold tracking-wide text-foreground transition-colors duration-300 group-hover:text-accent">
          {card.title}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {card.description}
        </p>
      </div>
    </>
  );

  if (card.url === "#") {
    return (
      <button onClick={() => onClick(card.url)} className={className}>
        {content}
      </button>
    );
  }

  return (
    <Link
      href={card.url}
      onClick={() => onClick(card.url)}
      className={className}
    >
      {content}
    </Link>
  );
}

/**
 * Grouped like the resources panel — a small label per group, then the same
 * title/description rows the other panels use.
 */
function SearchResults({
  query,
  onItemClick,
}: {
  query: string;
  onItemClick: (href: string) => void;
}) {
  const groups = searchContent(query);

  if (query.trim().length < MIN_QUERY) {
    return (
      <div className="px-2.5 py-6 text-center text-[11px] text-muted">
        Type at least {MIN_QUERY} characters to search
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="px-2.5 py-6 text-center text-[11px] text-muted">
        No results for &ldquo;{query.trim()}&rdquo;
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map(([group, items]) => (
        <div key={group}>
          <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-medium tracking-wider text-muted uppercase">
            {group}
          </div>
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <PanelRow
                key={group + item.title}
                item={item}
                onClick={onItemClick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
