import type { ReactNode } from "react";

/**
 * The shell both editor panes share. The height belongs to the pane, not to
 * the body inside it: only the request pane has a footer, so sizing the body
 * instead would leave the response pane with dead space under its content
 * where the other pane's footer sits.
 */

/** Tall enough to read a page of results without the page itself scrolling. */
const panelHeightClass = "h-[66vh] min-h-[440px]";

interface PanelProps {
  title: string;
  /** Small monospace detail beside the title — a path, a status line. */
  meta?: ReactNode;
  /** Controls pinned to the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  /**
   * Pinned over the body, outside the scroller — a control here stays put
   * while the content moves under it.
   */
  overlay?: ReactNode;
  footer?: ReactNode;
}

export default function Panel({ title, meta, actions, children, overlay, footer }: PanelProps) {
  return (
    <div
      className={`flex ${panelHeightClass} min-w-0 flex-col overflow-hidden rounded-md border border-panel-border bg-panel`}
    >
      {/* Fixed height, not padding: the two headers carry different controls —
          a Send button one side, a view toggle or nothing the other — and a
          bar that sizes to its contents leaves the panes misaligned. */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-panel-border bg-panel-header px-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-[10px] font-medium tracking-[0.2em] text-foreground uppercase">
            {title}
          </span>
          {meta}
        </div>
        {actions}
      </div>

      {/* `min-h-0` so this actually scrolls: a flex child will not shrink
          below its content without it. */}
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-auto">{children}</div>
        {overlay}
      </div>

      {footer && (
        <div className="shrink-0 border-t border-panel-border px-3 py-2 text-[11px] text-muted">
          {footer}
        </div>
      )}
    </div>
  );
}

/** A pane with nothing in it yet: an icon and one line saying what is missing. */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[12px] tracking-wider text-muted">
      {children}
    </div>
  );
}
