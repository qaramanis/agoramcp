"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Landmark, Plus } from "lucide-react";
import { menuItems } from "@/data/menu";
import DropdownContainer, { type DropdownType } from "./dropdown-container";
import SearchBar from "./search-bar";

interface NavigationDesktopProps {
  isScrolled: boolean;
}

/** Grace period so the pointer can cross the gap into the panel. */
const CLOSE_DELAY_MS = 150;

export default function NavigationDesktop({
  isScrolled,
}: NavigationDesktopProps) {
  const [activeDropdown, setActiveDropdown] = useState<DropdownType>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A focused input keeps the panel open even if the pointer wanders off. */
  const searchFocusedRef = useRef(false);

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (searchFocusedRef.current) return;
    closeTimeoutRef.current = setTimeout(
      () => setActiveDropdown(null),
      CLOSE_DELAY_MS,
    );
  }, []);

  const handleSearchFocus = useCallback(() => {
    cancelClose();
    searchFocusedRef.current = true;
    setActiveDropdown("search");
  }, [cancelClose]);

  // Delayed, so a click on a result lands before the panel goes away.
  const handleSearchBlur = useCallback(() => {
    searchFocusedRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  const handleSearchEscape = useCallback(() => {
    searchFocusedRef.current = false;
    cancelClose();
    setActiveDropdown(null);
  }, [cancelClose]);

  const handleSearchChange = useCallback(
    (value: string) => {
      cancelClose();
      setSearchQuery(value);
      setActiveDropdown("search");
    },
    [cancelClose],
  );

  const handleDropdownEnter = useCallback(
    (type: DropdownType) => {
      cancelClose();
      setActiveDropdown(type);
    },
    [cancelClose],
  );

  useEffect(() => cancelClose, [cancelClose]);

  // Pages don't exist yet, so selecting an item just closes the panel.
  const handleMenuItemClick = useCallback(() => {
    setActiveDropdown(null);
    setSearchQuery("");
  }, []);

  const getDropdownType = (title: string): DropdownType => {
    if (title === "Product") return "product";
    if (title === "Features") return "features";
    if (title === "Resources") return "resources";
    return null;
  };

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="pointer-events-auto absolute left-1/2 hidden -translate-x-1/2 transform flex-row items-center gap-6 rounded border border-panel-border bg-panel p-1.5 text-[12px] transition-all duration-300 ease-in-out md:flex"
      >
        {/* Fades in only once the outer logo has scrolled away. */}
        <Link
          href="/"
          className={`flex items-center justify-center gap-1.5 transition-all duration-300 ease-in-out hover:text-accent hover:opacity-80 ${
            isScrolled
              ? "w-[104px] opacity-100 blur-0"
              : "pointer-events-none w-0 opacity-0 blur-lg"
          }`}
        >
          <Landmark
            size={16}
            className="ml-2 -mt-0.5 shrink-0 text-foreground"
          />
          <span className="text-[11px] font-bold tracking-[0.15em] whitespace-nowrap text-foreground">
            AGORA.MCP
          </span>
        </Link>

        {menuItems.map((item) => {
          const dropdownType = getDropdownType(item.title);
          const hasDropdown = item.dropdown && dropdownType;

          if (hasDropdown) {
            return (
              <div
                key={item.title}
                className={`group flex h-7 cursor-pointer items-center justify-center rounded px-3 text-center font-medium tracking-wider uppercase transition-all duration-300 ${
                  activeDropdown === dropdownType
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background hover:text-foreground"
                }`}
                onMouseEnter={() => handleDropdownEnter(dropdownType)}
                onMouseLeave={scheduleClose}
                onClick={() => {
                  cancelClose();
                  setActiveDropdown(
                    activeDropdown === dropdownType ? null : dropdownType,
                  );
                }}
              >
                <span className="flex items-center text-[10px]">
                  {item.title}
                  <Plus
                    size={12}
                    className={`ml-1.5 transition-all duration-300 ${
                      activeDropdown === dropdownType ? "rotate-45" : ""
                    }`}
                  />
                </span>
              </div>
            );
          }

          return (
            <Link
              key={item.title}
              href={item.url}
              className="group flex h-7 cursor-pointer items-center justify-center rounded px-3 text-center font-medium tracking-wider text-muted-foreground uppercase transition-all duration-300 hover:bg-background hover:text-foreground"
              onMouseEnter={() => handleDropdownEnter(null)}
            >
              <span className="flex items-center text-[10px]">
                {item.title}
              </span>
            </Link>
          );
        })}

        {/* Hover opens the panel too — the input need not be focused. */}
        <div
          onMouseEnter={() => handleDropdownEnter("search")}
          onMouseLeave={scheduleClose}
        >
          <SearchBar
            query={searchQuery}
            onQueryChange={handleSearchChange}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            onEscape={handleSearchEscape}
            isActive={activeDropdown === "search"}
          />
        </div>

        {/* Mirrors the logo: slides in as the outer CTA fades out. */}
        <Link
          href="#"
          className={`flex h-7 cursor-pointer items-center justify-center overflow-hidden rounded border border-accent/40 bg-accent/20 text-center text-[10px] font-bold tracking-wider whitespace-nowrap text-accent uppercase transition-all duration-300 ease-in-out hover:bg-accent/30 ${
            isScrolled
              ? "w-[90px] opacity-100 blur-0"
              : "pointer-events-none w-0 opacity-0 blur-lg"
          }`}
        >
          Connect
        </Link>
      </nav>

      <DropdownContainer
        activeDropdown={activeDropdown}
        searchQuery={searchQuery}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onItemClick={handleMenuItemClick}
      />
    </>
  );
}
