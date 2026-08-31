"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onEscape: () => void;
  isActive: boolean;
}

/**
 * Lives inside the pill alongside the menu items. It owns nothing but the
 * input — results render in the shared dropdown panel, like every other item.
 */
export default function SearchBar({
  query,
  onQueryChange,
  onFocus,
  onBlur,
  onEscape,
  isActive,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      className={`flex h-7 items-center gap-1.5 rounded border border-panel-border px-2 transition-colors duration-300 ${
        isActive ? "bg-background" : "bg-panel-header"
      }`}
    >
      <Search size={12} className="shrink-0 text-muted" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search..."
        aria-label="Search sources"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onEscape();
            inputRef.current?.blur();
          }
        }}
        className="w-24 bg-transparent text-[10px] tracking-wider text-foreground outline-none placeholder:text-muted"
      />
      <kbd className="shrink-0 rounded border border-panel-border bg-panel px-1 py-0.5 text-[8px] tracking-wider text-muted">
        ⌘K
      </kbd>
    </div>
  );
}
