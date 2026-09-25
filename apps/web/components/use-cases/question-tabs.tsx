"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { columnGapClass } from "@/components/layout/grid";
import CodeBlock from "@/components/mcp/code-block";
import { Code } from "@/components/mcp/inline";
import { casePath, useCases, type UseCase } from "@/data/use-cases";

/** Where the selected question can be taken next. */
const EXITS = (slug: string) => [
  { title: "Read the walkthrough", href: casePath(slug) },
  { title: "Try a call in the browser", href: "/live" },
];

/** One leg of the panel's fade — the page fade's timing, `duration-300`. */
const FADE_MS = 300;

/**
 * The four questions on the left, and the selected one worked through on the
 * right: the prompt as typed, the tools that answer it in order, and the
 * registries behind them. All of it comes from `data/use-cases.ts`, the same
 * list the nav and the use-case pages read, so nothing here can name a tool
 * or a page that is not there.
 *
 * Ten columns carrying the page's gaps, the width the section deals it: the
 * heading and the list on four of the page's own columns, one of air, and
 * the panel on the last five, the two cells centred against each other.
 *
 * Picking a question moves the list at once and the panel a beat later: it
 * fades out on the old question, swaps, and fades back in on the new one, so
 * the content never changes while it can be seen.
 */
export default function QuestionTabs({ header }: { header: ReactNode }) {
  /** The tab that is selected — what the list shows. */
  const [index, setIndex] = useState(0);
  /** The question the panel is showing, which lags `index` by one fade. */
  const [shown, setShown] = useState(0);
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const select = (next: number) => {
    if (next === index) return;
    setIndex(next);
    setVisible(false);
    // A second pick mid-fade restarts the clock, so the panel swaps once, to
    // the last question chosen.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShown(next);
      setVisible(true);
    }, FADE_MS);
  };

  // Up and down move through the list, wrapping at either end, and take the
  // focus along so the keyboard is never left on a tab that is no longer the
  // selected one.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + useCases.length) % useCases.length;
    select(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className={`grid grid-cols-10 items-center gap-y-10 ${columnGapClass}`}>
      <div className="col-span-10 md:col-span-4">
        {header}

        <div
          role="tablist"
          aria-label="Questions"
          aria-orientation="vertical"
          onKeyDown={onKeyDown}
          className="mt-8 flex flex-col gap-1"
        >
          {useCases.map((entry, i) => {
            const selected = i === index;
            return (
              <button
                key={entry.slug}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`question-tab-${entry.slug}`}
                aria-selected={selected}
                aria-controls={`question-${entry.slug}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(i)}
                className="group cursor-pointer py-2 text-left"
              >
                <span
                  className={`flex items-center gap-1 text-[13px] transition duration-500 ease-out ${
                    selected
                      ? "translate-x-0 text-accent"
                      : "-translate-x-4 text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  {/* The chevron is part of the title, and the title slides
                      back by its width plus the gap when deselected, so the
                      unselected titles sit on the heading's edge with the
                      chevron faded out in the gutter. Only the chevron fades. */}
                  <ChevronRight
                    size={12}
                    aria-hidden
                    className={`shrink-0 transition-opacity duration-500 ease-out ${
                      selected ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  {/* The numbering is this page's: the data carries the plain
                      title, which the nav and the use-case pages show as is. */}
                  {`Example ${i + 1}: ${entry.title}`}
                </span>
                <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                  {entry.summary}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Every question's panel is rendered, stacked in the one cell, so the
          cell is as tall as the tallest of them and nothing beside or below
          it moves when the shown one changes. The others are hidden rather
          than removed: they keep the height and leave the accessibility tree. */}
      <div className="col-span-10 grid md:col-span-5 md:col-start-6">
        {useCases.map((entry, i) => {
          const showing = i === shown;
          return (
            <div
              key={entry.slug}
              role="tabpanel"
              id={`question-${entry.slug}`}
              aria-labelledby={`question-tab-${entry.slug}`}
              className={`col-start-1 row-start-1 transition-opacity duration-300 ease-out ${
                showing
                  ? visible
                    ? "opacity-100"
                    : "opacity-0"
                  : "invisible opacity-0"
              }`}
            >
              <Panel useCase={entry} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One question, worked: the prompt, the tools in order, the registries, the exits. */
function Panel({ useCase }: { useCase: UseCase }) {
  return (
    <>
      <p className="text-[11px] text-muted">Ask your agent</p>
      <div className="mt-2">
        <CodeBlock code={useCase.prompt} label="the prompt" wrap />
      </div>

      <p className="mt-8 text-[11px] text-muted">The tools it calls, in order</p>
      <ol className="mt-3 flex flex-col gap-3">
        {useCase.steps.map((step, i) => (
          <li key={step.tool} className="flex items-baseline gap-3">
            <span className="shrink-0 text-[13px] text-muted tabular-nums">
              {`${i + 1}.`}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13px] text-foreground">{step.title}</span>
              <Code>{step.tool}</Code>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-[11px] text-muted">Answered by</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {useCase.sources.map((source) => (
          <Link
            key={source.id}
            href={`/all/${source.country}/${source.id}`}
            className="flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
          >
            {source.name}
            <ArrowUpRight size={12} className="shrink-0" />
          </Link>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
        {EXITS(useCase.slug).map((exit) => (
          <Link
            key={exit.href}
            href={exit.href}
            className="flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent"
          >
            {exit.title}
            <ArrowUpRight size={12} className="shrink-0" />
          </Link>
        ))}
      </div>
    </>
  );
}
