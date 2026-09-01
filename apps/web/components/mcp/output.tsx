/**
 * A response as it came back. The same panel as `CodeBlock`, without the copy
 * button — nobody pastes a response into a terminal — and with room above for
 * the status line, which is as much a part of the answer as the body.
 */
export default function Output({
  code,
  status,
}: {
  code: string;
  /** The HTTP status line, when the body alone would not say how it went. */
  status?: string;
}) {
  return (
    <div className="rounded-md border border-panel-border bg-panel">
      {status && (
        <p className="border-b border-panel-border/70 px-3 py-1.5 text-[11px] text-muted">
          {status}
        </p>
      )}
      <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
