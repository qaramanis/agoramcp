"use client";

import { useCallback, useRef, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { Grid } from "@/components/layout/grid";
import {
  defaultValues,
  type PlaygroundCountry,
  type PlaygroundTool,
} from "@/data/playground";
import Panel, { Placeholder } from "./panel";
import RequestPanel from "./request-panel";
import ResponsePanel, { type McpResult } from "./response-panel";
import Toolbar from "./toolbar";

/**
 * The live console. Holds the selection and the one in-flight call; the two
 * panes are otherwise independent of each other.
 *
 * Nothing starts chosen. A page that opened on Greece → Diavgeia → the first
 * tool would be showing a request the visitor never asked for, and would hide
 * the fact that there is a catalogue to pick from at all.
 *
 * Nothing about Diavgeia appears here either — country, provider, tool and
 * every field come from the MCP server's registry, loaded by the page and
 * handed in, so a second source lights this page up without touching it.
 */
export default function Playground({
  countries,
  unavailable,
}: {
  countries: PlaygroundCountry[];
  /** Why there is nothing to pick from, when the registry could not be read. */
  unavailable: string | null;
}) {
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [toolName, setToolName] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<McpResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef<AbortController | null>(null);

  const country = countries.find((item) => item.code === countryCode) ?? null;
  const provider = country?.providers.find((item) => item.id === providerId) ?? null;
  const tool = provider?.tools.find((item) => item.name === toolName) ?? null;

  /** A different selection is a different call — the old answer no longer applies. */
  const reset = useCallback((next: PlaygroundTool | null) => {
    inFlight.current?.abort();
    inFlight.current = null;
    setValues(next ? defaultValues(next) : {});
    setResult(null);
    setError(null);
    setBusy(false);
  }, []);

  // Choosing higher up clears everything below it rather than guessing a
  // replacement.
  const selectCountry = (code: string) => {
    setCountryCode(code);
    setProviderId(null);
    setToolName(null);
    reset(null);
  };

  const selectProvider = (id: string) => {
    setProviderId(id);
    setToolName(null);
    reset(null);
  };

  const selectTool = (name: string) => {
    const next = provider?.tools.find((item) => item.name === name) ?? null;
    setToolName(next?.name ?? null);
    reset(next);
  };

  const send = useCallback(async () => {
    if (!provider || !tool) return;

    // A second Send supersedes the first rather than racing it.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: provider.endpoint, tool: tool.name, values }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as Partial<McpResult> & { error?: string };

      if (!response.ok || typeof payload.error === "string") {
        setError(payload.error ?? `The playground answered ${response.status}.`);
      } else {
        setResult(payload as McpResult);
      }
    } catch (thrown) {
      if ((thrown as Error).name === "AbortError") return;
      setError("The request could not be sent from this browser.");
    } finally {
      // Only the newest call owns the busy flag.
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  }, [provider, tool, values]);

  return (
    // Twelve columns of the page's own, so the two panes split it in half on
    // the same line every other block on the page is measured against.
    <Grid inset={false} className="gap-y-4">
      {unavailable && (
        <p className="col-span-12 col-start-1 text-[12px] leading-relaxed text-warn">
          {unavailable} There is nothing to pick from until it is back.
        </p>
      )}

      <div className="col-span-12 col-start-1">
        <Toolbar
          countries={countries}
          country={country}
          provider={provider}
          tool={tool}
          onCountryChange={selectCountry}
          onProviderChange={selectProvider}
          onToolChange={selectTool}
        />
      </div>

      <div className="col-span-12 col-start-1 lg:col-span-6">
        {provider && tool ? (
          <RequestPanel
            endpoint={provider.endpoint}
            tool={tool}
            values={values}
            busy={busy}
            onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
            onSend={send}
          />
        ) : (
          <Panel title="Request">
            <Placeholder>
              <MousePointerClick size={18} />
              Choose a country, a provider and a tool
            </Placeholder>
          </Panel>
        )}
      </div>

      <div className="col-span-12 col-start-1 lg:col-span-6 lg:col-start-7">
        <ResponsePanel busy={busy} result={result} error={error} />
      </div>

      {/* Deliberately says nothing source-specific, so it reads the same
          whatever is selected. Each response still carries its publisher and
          licence: the MCP server sends them as the session's instructions. */}
      <p className="col-span-12 col-start-1 text-[11px] leading-relaxed text-muted">
        Calls run against the live registry, not a fixture. Responses are public data returned
        unmodified, under whatever licence the publishing body sets. Check that source&apos;s own
        terms before reusing it.
      </p>
    </Grid>
  );
}
