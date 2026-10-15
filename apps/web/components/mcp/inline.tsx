import type { ReactNode } from "react";

/**
 * An inline literal — a path, a flag, or a tool name as it goes over the wire.
 * Mono whatever it sits in: the long-form pages set their prose in Geist.
 */
export function Code({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-xs bg-muted-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
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
      {text
        .split(/`([^`]+)`/)
        .map((part, index) =>
          index % 2 === 1 ? (
            <Code key={index}>{part}</Code>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
    </>
  );
}

/**
 * Picks the placeholders out of an address pattern. They carry the accent and
 * the fixed segments do not, so the line reads as a template rather than as
 * one more example URL.
 */
export function Shape({ pattern }: { pattern: string }) {
  return (
    <>
      {pattern.split(/(\{[a-z]+\})/).map((part, index) => (
        <span
          key={index}
          className={
            part.startsWith("{") ? "text-accent" : "text-muted-foreground"
          }
        >
          {part}
        </span>
      ))}
    </>
  );
}
