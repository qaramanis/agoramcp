"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Squash as Hamburger } from "hamburger-react";
import {
  menuItems,
  productCards,
  productItems,
  resourceCards,
  resourceItems,
  useCaseItems,
} from "@/data/menu";

/**
 * Each dropdown's rows and cards, flattened into one plain list — on a phone
 * the cover-image cards are just more links under the same heading.
 */
const subMenuMap: Record<string, { title: string; url: string }[]> = {
  Product: [...productItems, ...productCards],
  "Use cases": useCaseItems,
  Resources: [...resourceItems, ...resourceCards],
};

function MobileNavItem({
  title,
  href,
  onClick,
  hasDropdown,
  isExpanded,
  onToggleExpand,
}: {
  title: string;
  href: string;
  onClick?: () => void;
  hasDropdown?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const subItems = hasDropdown ? subMenuMap[title] || [] : [];

  const row = (
    <div className="flex flex-row items-center justify-between py-2">
      <span className="text-xl text-foreground">{title}</span>
      {hasDropdown && (
        <Plus
          size={18}
          strokeWidth={1.5}
          className={`text-foreground/40 transition-transform duration-300 ${
            isExpanded ? "rotate-45" : ""
          }`}
        />
      )}
    </div>
  );

  return (
    <div className="flex w-full flex-col leading-none">
      {/* A dropdown heading is "#" in the menu data, so it only toggles. */}
      {hasDropdown ? (
        <button
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          className="flex w-full cursor-pointer flex-col text-left transition-all duration-300"
        >
          {row}
        </button>
      ) : (
        <Link
          href={href}
          onClick={onClick}
          className="flex w-full flex-col transition-all duration-300"
        >
          {row}
        </Link>
      )}
      {hasDropdown && (
        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: isExpanded ? `${subItems.length * 3}rem` : "0",
            opacity: isExpanded ? 1 : 0,
          }}
        >
          <div className="flex flex-col gap-2 py-2 pl-4">
            {subItems.map((sub) => (
              <Link
                key={sub.title}
                href={sub.url}
                onClick={onClick}
                className="text-base text-foreground/60 transition-all duration-300 hover:text-foreground"
              >
                {sub.title}
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="my-1 h-px w-full bg-foreground/10" />
    </div>
  );
}

export default function NavigationMobile() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => {
    setIsOpen(false);
    setExpandedItem(null);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: Event) => {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  // Lock body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";

      return () => {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        document.body.style.overflow = "";
        // Instant: globals.css makes html scroll smoothly, which would
        // otherwise glide back down from the top of the page.
        window.scrollTo({ top: scrollY, behavior: "instant" });
      };
    }
  }, [isOpen]);

  // Close menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        closeMenu();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  return (
    <>
      {/* Hamburger button - mobile only */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="pointer-events-auto flex aspect-square h-8 cursor-pointer items-center justify-center rounded-md bg-transparent p-0 text-sm transition-all duration-300 md:hidden"
        aria-label="Toggle navigation menu"
        aria-expanded={isOpen}
      >
        <div>
          <Hamburger
            size={24}
            color="currentColor"
            toggled={isOpen}
            toggle={setIsOpen}
          />
        </div>
      </button>

      {/* Mobile menu backdrop */}
      <div
        className={`fixed inset-0 top-[52px] z-98 bg-background/50 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          isOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onClick={closeMenu}
        aria-hidden="true"
      />

      {/* Mobile menu panel */}
      <div
        ref={menuRef}
        className={`fixed top-[52px] right-0 bottom-0 z-99 flex w-full flex-col justify-between overflow-y-auto bg-background px-5 pt-6 pb-8 transition-all duration-300 ease-in-out md:hidden ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!isOpen}
      >
        <div className="flex flex-col gap-2.5">
          {menuItems.map((item) => (
            <MobileNavItem
              key={item.title}
              title={item.title}
              href={item.url}
              onClick={closeMenu}
              hasDropdown={item.dropdown}
              isExpanded={expandedItem === item.title}
              onToggleExpand={() =>
                setExpandedItem((prev) =>
                  prev === item.title ? null : item.title,
                )
              }
            />
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="flex flex-col gap-3">
          <Link
            href="/quickstart"
            onClick={closeMenu}
            className="flex h-10 cursor-pointer items-center justify-center rounded border border-accent/40 bg-accent/20 text-center text-xs font-bold tracking-wider text-accent uppercase transition-all duration-300 hover:bg-accent/30"
          >
            Connect
          </Link>
        </div>
      </div>
    </>
  );
}
