import { Check, Copy } from "lucide-react";

/**
 * The copy button's glyph, shared by every copy button on the site.
 *
 * Both icons are always there, stacked in one cell, and cross-fade: the one
 * arriving grows from a quarter of its size out of a blur, so the swap reads
 * as one mark turning into the other rather than two trading places. Under
 * reduced motion it is the fade alone.
 */
export default function CopyIcon({ copied }: { copied: boolean }) {
  const hidden = "opacity-0 motion-safe:scale-25 motion-safe:blur-[4px]";
  const glyph = "transition-[opacity,scale,filter] duration-200 ease-out";

  return (
    <span className="grid *:col-start-1 *:row-start-1">
      <Copy size={13} className={`${glyph} ${copied ? hidden : ""}`} />
      <Check size={13} className={`${glyph} ${copied ? "" : hidden}`} />
    </span>
  );
}
