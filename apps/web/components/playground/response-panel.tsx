"use client";

import { useEffect, useRef, useState } from "react";
import { Braces, Check, Copy, Loader2, TriangleAlert } from "lucide-react";
import JsonView from "./json-view";
import Panel, { Placeholder } from "./panel";

export type McpResult = {
  status: number;
  durationMs: number;
  bytes: number;
  body: unknown;
};

interface ResponsePanelProps {
  busy: boolean;
  result: McpResult | null;
  /** Set when the call never reached the MCP server at all. */
  error: string | null;
}

type View = "result" | "raw";

export default function ResponsePanel({ busy, result, error }: ResponsePanelProps) {
  const [view, setView] = useState<View>("result");

  const unwrapped = result ? unwrap(result.body) : null;
  // Whatever is on screen is what gets copied — switching to Raw copies the
  // envelope, not the payload.
  const shown = !unwrapped
    ? null
    : view === "raw"
      ? JSON.stringify(result?.body, null, 2)
      : unwrapped.text;
  const failed = Boolean(error) || (unwrapped?.isError ?? false);
  // The controls stay in the header with nothing to act on, so the bar keeps
  // its shape from the first paint instead of assembling itself on the first
  // response. They just cannot be used yet.
  const inert = !result || busy;

  return (
    <Panel
      title="Response"
      meta={
        result && !busy ? (
          <span
            className={`font-mono text-[11px] whitespace-nowrap ${
              failed ? "text-warn" : "text-muted"
            }`}
          >
            {result.status} · {formatDuration(result.durationMs)} · {formatBytes(result.bytes)}
          </span>
        ) : null
      }
      actions={
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-0.5 rounded border border-panel-border p-0.5 transition-opacity duration-300 ${
              inert ? "opacity-40" : ""
            }`}
          >
            {(["result", "raw"] as View[]).map((option) => (
              <button
                key={option}
                type="button"
                disabled={inert}
                onClick={() => setView(option)}
                className={`rounded-sm px-2 py-1 text-[10px] font-medium tracking-wider uppercase transition-colors duration-300 disabled:cursor-not-allowed ${
                  view === option
                    ? "bg-background text-foreground"
                    : "text-muted enabled:hover:text-muted-foreground"
                } ${inert ? "" : "cursor-pointer"}`}
              >
                {option}
              </button>
            ))}
          </div>

          {/* Not wired up yet — the shape of the control, so the header can be
              judged with it in place. */}
          <button
            type="button"
            disabled={inert}
            className="flex h-7 shrink-0 cursor-pointer items-center justify-center rounded border border-accent/40 bg-accent/20 px-3 text-center text-[10px] font-bold tracking-wider text-accent uppercase transition-all duration-300 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent/20"
          >
            Visualize
          </button>
        </div>
      }
      overlay={shown === null || busy ? undefined : <CopyButton text={shown} />}
    >
      {busy ? (
        <Placeholder>
          <Loader2 size={18} className="animate-spin text-accent motion-reduce:animate-none" />
          Awaiting response
        </Placeholder>
      ) : error ? (
        <Message tone="warn" icon={<TriangleAlert size={18} />}>
          {error}
        </Message>
      ) : !result || !unwrapped ? (
        <Placeholder>
          <Braces size={18} />
          Awaiting request
        </Placeholder>
      ) : view === "raw" ? (
        <JsonView text={JSON.stringify(result.body, null, 2)} />
      ) : unwrapped.kind === "text" ? (
        <Message tone={unwrapped.isError ? "warn" : "muted"} icon={<TriangleAlert size={18} />}>
          {unwrapped.text}
        </Message>
      ) : (
        <JsonView text={unwrapped.text} />
      )}
    </Panel>
  );
}

/** Two seconds of acknowledgement, then back — no toast, no layout shift. */
const COPIED_MS = 2_000;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
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
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Response copied" : "Copy response"}
      title={copied ? "Copied" : "Copy response"}
      // Clear of the 6px scrollbar, and translucent so the JSON underneath
      // stays legible as it scrolls past.
      className={`absolute top-2 right-3 flex h-7 w-7 cursor-pointer items-center justify-center rounded border bg-panel-header/90 backdrop-blur-sm transition-colors duration-300 ${
        copied
          ? "border-accent/40 text-accent"
          : "border-panel-border text-muted hover:border-accent/50 hover:text-foreground"
      }`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function Message({
  tone,
  icon,
  children,
}: {
  tone: "warn" | "muted";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-full items-start gap-3 px-4 py-4 text-[12px] leading-relaxed ${
        tone === "warn" ? "text-warn" : "text-muted-foreground"
      }`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="m-0 whitespace-pre-wrap">{children}</p>
    </div>
  );
}

type Unwrapped = { text: string; isError: boolean; kind: "json" | "text" };

/**
 * A tool's answer arrives as a string inside `result.content[0].text`, which
 * displayed raw is a wall of escaped quotes. This digs it back out — and keeps
 * a tool-level failure, which arrives as prose with `isError` set, as prose.
 */
function unwrap(body: unknown): Unwrapped {
  const envelope = body as {
    result?: { content?: { type?: string; text?: string }[]; isError?: boolean };
    error?: unknown;
  };

  if (envelope?.error !== undefined) {
    return { text: JSON.stringify(envelope.error, null, 2), isError: true, kind: "json" };
  }

  const content = envelope?.result?.content;
  if (!Array.isArray(content)) {
    return { text: JSON.stringify(body, null, 2), isError: false, kind: "json" };
  }

  const isError = envelope.result?.isError === true;
  const text = content
    .filter((part) => part?.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");

  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), isError, kind: "json" };
  } catch {
    return { text, isError, kind: "text" };
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
