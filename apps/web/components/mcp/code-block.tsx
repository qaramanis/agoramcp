"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/** Two seconds of acknowledgement, then back — the playground's timing. */
const COPIED_MS = 2_000;

interface CodeBlockProps {
  /**
   * Copied verbatim, so it carries no prompt character and no ellipsis. What
   * is on screen is what lands in the terminal.
   */
  code: string;
  /** Names the thing being copied, for the tooltip and screen readers. */
  label: string;
  /**
   * Wraps instead of scrolling. For a block holding a sentence rather than a
   * command: a prompt is read before it is copied, and a line of English that
   * runs off the edge is the one thing the reader came for. Commands and JSON
   * keep the scroll, where a wrap would invent a line break that isn't there.
   */
  wrap?: boolean;
}

export default function CodeBlock({ code, label, wrap = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Blocked, or no clipboard permission. Say nothing rather than claim a
      // copy that did not happen.
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <div className="relative rounded-md border border-panel-border bg-panel">
      {/* The right padding is the button's lane: a long line scrolls under it
          rather than stopping short of it, and a wrapped one breaks before it. */}
      <pre
        className={`px-3 py-3 pr-12 text-[12px] leading-relaxed text-foreground ${
          wrap ? "whitespace-pre-wrap" : "overflow-x-auto"
        }`}
      >
        <code>{code}</code>
      </pre>

      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? "Copied" : "Copy"}
        className={`absolute top-2 right-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded border bg-panel-header/90 backdrop-blur-sm transition-colors duration-300 ${
          copied
            ? "border-accent/40 text-accent"
            : "border-panel-border text-muted hover:border-accent/50 hover:text-foreground"
        }`}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
