"use client";

import { useCallback, useRef, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { countries, defaultValues, type PlaygroundTool } from "@/data/playground";
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
 * every field come from `data/playground.ts`, so a second source lights this
 * page up without touching it.
 */
export default function Playground() {
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
    <div className="flex flex-col gap-4">
      <Toolbar
        country={country}
        provider={provider}
        tool={tool}
        onCountryChange={selectCountry}
        onProviderChange={selectProvider}
        onToolChange={selectTool}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              Choose a country, a provider and a tool to build a request
            </Placeholder>
          </Panel>
        )}

        <ResponsePanel busy={busy} result={result} error={error} />
      </div>

      {/* Deliberately says nothing source-specific, so it reads the same
          whatever is selected. Each response still carries its publisher and
          licence: the MCP server sends them as the session's instructions. */}
      <p className="text-[11px] leading-relaxed text-muted">
        Calls run against the live registry, not a fixture. Responses are public data returned
        unmodified, under whatever licence the publishing body sets — check that source&apos;s own
        terms before reusing it.
      </p>
    </div>
  );
}
