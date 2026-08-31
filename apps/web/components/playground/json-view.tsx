import { Fragment, type ReactNode } from "react";

/**
 * Read-only JSON, coloured. Two content hues only — strings in the accent,
 * every other scalar in the cool secondary — so a long response still reads as
 * this site rather than as a generic editor theme.
 */

/** Group 1 is a string; group 2 is present only when that string is a key. */
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Past this, highlighting costs more than it is worth. */
const MAX_HIGHLIGHT_CHARS = 200_000;

export default function JsonView({ text }: { text: string }) {
  return (
    <pre className="m-0 px-4 py-3 font-mono text-[12px] leading-6 whitespace-pre text-muted">
      <code>{text.length > MAX_HIGHLIGHT_CHARS ? text : highlight(text)}</code>
    </pre>
  );
}

function highlight(json: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN.exec(json)) !== null) {
    if (match.index > cursor) nodes.push(json.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const [whole, str, colon] = match;

    if (str && colon) {
      nodes.push(
        <Fragment key={key++}>
          <span className="text-code-key">{str}</span>
          {colon}
        </Fragment>,
      );
    } else if (str) {
      nodes.push(
        <span key={key++} className="text-code-string">
          {str}
        </span>,
      );
    } else {
      nodes.push(
        <span key={key++} className="text-code-scalar">
          {whole}
        </span>,
      );
    }
  }

  if (cursor < json.length) nodes.push(json.slice(cursor));
  return nodes;
}
