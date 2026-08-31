"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  countries,
  type PlaygroundCountry,
  type PlaygroundProvider,
  type PlaygroundTool,
} from "@/data/playground";
import Select from "./select";

interface ToolbarProps {
  country: PlaygroundCountry | null;
  provider: PlaygroundProvider | null;
  tool: PlaygroundTool | null;
  onCountryChange: (code: string) => void;
  onProviderChange: (id: string) => void;
  onToolChange: (name: string) => void;
}

/**
 * Country narrows to provider, provider narrows to tool. Nothing is chosen on
 * the user's behalf, and a selector whose parent is still empty says which
 * choice it is waiting on rather than sitting there greyed and mute.
 */
export default function Toolbar({
  country,
  provider,
  tool,
  onCountryChange,
  onProviderChange,
  onToolChange,
}: ToolbarProps) {
  return (
    <div className="rounded-md border border-panel-border bg-panel p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.6fr]">
        <Select
          label="Country"
          value={country?.code ?? null}
          placeholder="Select a country"
          onChange={onCountryChange}
          options={countries.map((item) => ({
            value: item.code,
            label: item.name,
            note: `${item.providers.length} ${item.providers.length === 1 ? "source" : "sources"}`,
          }))}
        />

        <Select
          label="Provider"
          value={provider?.id ?? null}
          placeholder="Select a provider"
          blockedBy={country ? undefined : "Please select a country first"}
          onChange={onProviderChange}
          options={(country?.providers ?? []).map((item) => ({
            value: item.id,
            label: item.name,
            note: item.endpoint,
          }))}
        />

        <Select
          label="Tool"
          value={tool?.name ?? null}
          placeholder="Select a tool"
          blockedBy={provider ? undefined : "Please select a provider first"}
          onChange={onToolChange}
          options={(provider?.tools ?? []).map((item) => ({
            value: item.name,
            label: item.name,
            note: item.title,
          }))}
        />
      </div>

      <div className="mt-3 border-t border-panel-border/70 pt-3">
        <AnimatedHeight>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {tool ? (
              <>
                {/* Named like a label rather than buried in the sentence: the
                    darker chip and the colon are what say the rest of the line
                    is this tool's description. */}
                <span className="bg-background text-foreground rounded-xs px-1.5 py-0.5 font-mono text-[11px]">
                  {tool.name}
                </span>
                <span className="text-muted">: </span>
                {tool.summary}
              </>
            ) : (
              <span className="">{guidance(country, provider)}</span>
            )}
          </p>
        </AnimatedHeight>
      </div>
    </div>
  );
}

/**
 * Grows and shrinks to fit its content instead of snapping to it. A
 * description runs to one line or three depending on the tool and the
 * viewport, and the panel jumping under the selector reads as a glitch.
 *
 * Same measure-then-transition idea as the nav's dropdown, except the content
 * reports its own size — so the height also follows text reflowing on a window
 * resize, not just a change of selection.
 */
function AnimatedHeight({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  // `null` until measured, so the first paint is the content's natural height
  // and there is nothing to animate from.
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      style={height === null ? undefined : { height }}
      className="overflow-hidden transition-[height] duration-300 ease-in-out motion-reduce:transition-none"
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

function guidance(
  country: PlaygroundCountry | null,
  provider: PlaygroundProvider | null,
): string {
  if (!country) return "Please select a country first";
  if (!provider) return `Now pick one of ${country.name}'s sources.`;
  return `Pick one of ${provider.name}'s tools to build a request.`;
}
