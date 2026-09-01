"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  /** Second line, and searched alongside the label. */
  note?: string;
};

interface SelectProps {
  label: string;
  /** `null` until a choice is made — nothing is selected on the user's behalf. */
  value: string | null;
  options: SelectOption[];
  placeholder: string;
  /**
   * Why this selector cannot be used yet, e.g. "Please select a country
   * first". Set means disabled, and the message replaces the placeholder.
   */
  blockedBy?: string;
  onChange: (value: string) => void;
}

/**
 * A searchable selector. The list opens under the field with its own search
 * field already focused, so a long list is narrowed by typing rather than by
 * scrolling — the nav's search bar, scoped to one field.
 */
export default function Select({
  label,
  value,
  options,
  placeholder,
  blockedBy,
  onChange,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? null;
  const blocked = Boolean(blockedBy);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(needle) ||
          option.value.toLowerCase().includes(needle) ||
          (option.note?.toLowerCase().includes(needle) ?? false),
      )
    : options;

  // Clamped rather than corrected in state: the list can shrink under the
  // cursor on any keystroke.
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (!open) return;

    inputRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keeps the highlighted row visible while arrowing through a filtered list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = matches[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const from = Math.min(current, matches.length - 1);
        return (from + step + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-col gap-1.5">
      <span className="text-[9px] font-medium tracking-[0.2em] text-muted uppercase">{label}</span>

      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={blocked}
        onClick={() => {
          setQuery("");
          setActive(Math.max(0, options.findIndex((option) => option.value === value)));
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-8 w-full items-center justify-between gap-3 rounded border px-2.5 text-left text-[12px] transition-colors duration-300 ${
          blocked
            ? "cursor-not-allowed border-panel-border/60 bg-panel-header text-muted"
            : open
              ? "cursor-pointer border-accent/50 bg-background text-foreground"
              : "cursor-pointer border-panel-border bg-panel text-foreground hover:border-accent/50"
        }`}
      >
        <span className={`truncate ${selected ? "text-foreground" : "text-muted"}`}>
          {blockedBy ?? selected?.label ?? placeholder}
        </span>
        {!blocked && (
          <ChevronDown
            size={13}
            className={`shrink-0 text-muted transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded border border-panel-border bg-panel">
          <div className="flex items-center gap-1.5 border-b border-panel-border bg-panel-header px-2.5 py-2">
            <Search size={12} className="shrink-0 text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder={`Search ${label.toLowerCase()}...`}
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={listId}
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted"
            />
          </div>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-64 list-none overflow-auto p-1"
          >
            {matches.length === 0 ? (
              <li className="px-2.5 py-6 text-center text-[11px] text-muted">
                No matches
              </li>
            ) : (
              matches.map((option, index) => (
                <li key={option.value} data-index={index}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(index)}
                    className={`w-full cursor-pointer rounded-sm px-2 py-1.5 text-left transition-colors duration-200 ${
                      index === activeIndex ? "bg-background" : ""
                    }`}
                  >
                    <span
                      className={`block truncate text-[12px] ${
                        option.value === value ? "text-accent" : "text-foreground"
                      }`}
                    >
                      {option.label}
                    </span>
                    {option.note && (
                      <span className="mt-0.5 block truncate text-[10px] text-muted">
                        {option.note}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
