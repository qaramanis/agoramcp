import type { ReactNode } from "react";

/** An inline literal — a path, a flag, or a tool name as it goes over the wire. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-xs bg-background px-1.5 py-0.5 text-[11px] text-foreground">
      {children}
    </span>
  );
}

/**
 * Renders `backticked` spans inside a plain string, so prose can live in a data
 * file and still mark up the literals in it.
 */
export function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, index) =>
        index % 2 === 1 ? <Code key={index}>{part}</Code> : <span key={index}>{part}</span>,
      )}
    </>
  );
}
