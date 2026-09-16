"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, Lock } from "lucide-react";
import type { PlaygroundTool, ToolField } from "@/data/playground";
import Panel from "./panel";

interface RequestPanelProps {
  endpoint: string;
  tool: PlaygroundTool;
  values: Record<string, string>;
  busy: boolean;
  onChange: (name: string, value: string) => void;
  onSend: () => void;
}

/**
 * The call as it will go out, laid out as the JSON-RPC body it is. The
 * envelope is fixed — change `method` or `name` and there is nothing left to
 * demonstrate — so only the values inside `arguments` are editable. Everything
 * else is text, dimmed to say so.
 *
 * Every editable token renders the value that will actually be sent, never a
 * friendlier stand-in for it. A pane that claims to be the request has to be
 * one.
 */
export default function RequestPanel({
  endpoint,
  tool,
  values,
  busy,
  onChange,
  onSend,
}: RequestPanelProps) {
  const [focused, setFocused] = useState<string | null>(null);
  // The platform is not known while rendering on the server, and a hint that
  // differs between server and client is a hydration mismatch — so the server
  // renders nothing and the browser fills it in on its first commit.
  const shortcut = useSyncExternalStore(subscribeNever, readShortcut, () => null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSend();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSend]);

  const hint = tool.fields.find((field) => field.name === focused)?.hint;

  return (
    <Panel
      title="Request"
      meta={
        <span className="truncate rounded-xs bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted">
          POST <span className="text-foreground">{endpoint}</span>
        </span>
      }
      actions={
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          className="flex h-7 shrink-0 cursor-pointer items-center justify-center gap-2 rounded border border-accent/40 bg-accent/20 px-3 text-center text-[10px] font-bold tracking-wider text-accent uppercase transition-all duration-300 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Sending" : "Send"}
          {/* `normal-case` so the Windows label stays "Ctrl", not "CTRL". */}
          {shortcut && (
            <span className="hidden font-mono text-[10px] font-normal tracking-normal text-accent/60 normal-case sm:inline">
              {shortcut}
            </span>
          )}
        </button>
      }
      footer={
        hint ?? (
          <span className="flex items-center gap-1.5">
            <Lock size={11} className="shrink-0" />
            Only the arguments are editable. Blank fields are left out of the call.
          </span>
        )
      }
    >
      <div className="px-4 py-3 font-mono text-[12px] leading-7 text-muted">
        <Line>{"{"}</Line>

        <Fixed indent={1} name="jsonrpc" value='"2.0"' />
        <Fixed indent={1} name="id" value="1" />
        <Fixed indent={1} name="method" value='"tools/call"' />
        <Fixed indent={1} name="params" value="{" bare />
        <Fixed indent={2} name="name" value={`"${tool.name}"`} />
        <Fixed indent={2} name="arguments" value="{" bare />

        {tool.fields.map((field, index) => (
          <FieldLine
            key={field.name}
            field={field}
            value={values[field.name] ?? ""}
            last={index === tool.fields.length - 1}
            onChange={(next) => onChange(field.name, next)}
            onFocus={() => setFocused(field.name)}
            onBlur={() => setFocused(null)}
          />
        ))}

        <Line indent={2} dim>
          {"}"}
        </Line>
        <Line indent={1} dim>
          {"}"}
        </Line>
        <Line>{"}"}</Line>
      </div>
    </Panel>
  );
}

/** The hint never changes for the life of the page. */
const subscribeNever = () => () => {};

function readShortcut(): string {
  // The modifier stays a glyph, the key is spelled out — "⌘↵" asks the reader
  // to decode two symbols at 10px.
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? "⌘Enter"
    : "Ctrl+Enter";
}

/** Two spaces per level, in the font's own character width. */
function Line({
  indent = 0,
  dim,
  children,
}: {
  indent?: number;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{ paddingLeft: `${indent * 2}ch` }}
      className={dim ? "text-muted/70" : undefined}
    >
      {children}
    </div>
  );
}

/** A line of the envelope: rendered, never edited. */
function Fixed({
  indent,
  name,
  value,
  bare,
}: {
  indent: number;
  name: string;
  value: string;
  /** An opening brace takes no comma. */
  bare?: boolean;
}) {
  return (
    <Line indent={indent} dim>
      <span>&quot;{name}&quot;</span>: <span>{value}</span>
      {bare ? "" : ","}
    </Line>
  );
}

function FieldLine({
  field,
  value,
  last,
  onChange,
  onFocus,
  onBlur,
}: {
  field: ToolField;
  value: string;
  last: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const omitted = field.optional && value.trim() === "";
  // A choice writes its own quotes, because the quotes are part of the token
  // it opens a menu from.
  const quoted = field.kind === "text" || field.kind === "date";
  const gloss = field.choices?.find((choice) => choice.value === value)?.label;

  return (
    <Line indent={3}>
      <span className="text-code-key">&quot;{field.name}&quot;</span>
      <span>: </span>
      {quoted && <span className="text-code-string">&quot;</span>}
      <FieldInput
        field={field}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {quoted && <span className="text-code-string">&quot;</span>}
      {!last && <span>,</span>}

      {/* An annotation, not a state: the field beside it is as editable as any
          other, and only the note says a blank one will not be sent. */}
      {omitted ? (
        <span className="ml-3 text-[10px] tracking-wider text-muted">omitted</span>
      ) : gloss ? (
        <span className="ml-3 text-[10px] tracking-wider text-muted">{gloss}</span>
      ) : null}
    </Line>
  );
}

/**
 * Shared by every kind: a value token that happens to accept input. Carries no
 * colour of its own — two text utilities on one element are resolved by
 * stylesheet order rather than class order, so each kind sets exactly one.
 *
 * `leading-5` is what keeps the chips apart. An input inherits the block's
 * line-height as its content height, so at the block's own leading a chip is
 * fractionally taller than the line box and neighbouring rows collide. Sizing
 * the token below the line leaves the gap.
 */
const inputClass =
  "rounded-xs border-none border-transparent bg-panel-border px-1 leading-5 outline-none transition-colors duration-200 placeholder:text-muted hover:bg-muted/70 focus:border-accent focus:bg-muted/70";

function FieldInput({
  field,
  value,
  onChange,
  onFocus,
  onBlur,
}: {
  field: ToolField;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  if (field.kind === "choice") {
    return (
      <ChoiceToken
        field={field}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  }

  const shared = {
    value,
    onFocus,
    onBlur,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(event.target.value),
  };

  if (field.kind === "boolean") {
    // `true` and `false` are their own labels, so a plain select is already
    // showing exactly what will be sent.
    return (
      <select
        {...shared}
        aria-label={field.name}
        className={`${inputClass} cursor-pointer text-code-scalar`}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    );
  }

  if (field.kind === "date") {
    return (
      <input
        {...shared}
        type="date"
        aria-label={field.name}
        className={`${inputClass} text-code-string [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-40`}
      />
    );
  }

  if (field.kind === "number") {
    return (
      <input
        {...shared}
        type="number"
        min={field.min}
        max={field.max}
        aria-label={field.name}
        className={`${inputClass} w-[7ch] text-code-scalar`}
      />
    );
  }

  // Sized to its own content so the line reads as a JSON string rather than a
  // form field sitting in one.
  const width = Math.max(value.length, field.placeholder?.length ?? 0, 4);

  return (
    <input
      {...shared}
      type="text"
      aria-label={field.name}
      placeholder={field.placeholder}
      spellCheck={false}
      style={{ width: `calc(${width}ch + 0.5rem)` }}
      className={`${inputClass} text-code-string`}
    />
  );
}

/**
 * A quoted string that opens a menu. The token shows the code — Διαύγεια's
 * `Δ.1`, not "contract award" — because that is the string the server will
 * receive; the gloss goes at the end of the line instead.
 */
function ChoiceToken({
  field,
  value,
  onChange,
  onFocus,
  onBlur,
}: {
  field: ToolField;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const choices = field.choices ?? [];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label={field.name}
        aria-expanded={open}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        className={`${inputClass} inline-flex cursor-pointer items-center gap-1 align-baseline`}
      >
        <span className="min-w-[5ch] text-left text-code-string">&quot;{value}&quot;</span>
        <ChevronDown
          size={11}
          className={`shrink-0 text-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <ul className="absolute top-full left-0 z-50 mt-1 max-h-56 w-max list-none overflow-auto rounded border border-panel-border bg-panel p-1">
          {choices.map((choice) => (
            <li key={choice.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(choice.value);
                  setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-baseline gap-3 rounded-sm px-2 py-1.5 text-left transition-colors duration-200 hover:bg-background ${
                  choice.value === value ? "bg-background" : ""
                }`}
              >
                <span className="w-[6ch] shrink-0 text-code-string">{choice.value || "-"}</span>
                <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                  {choice.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
