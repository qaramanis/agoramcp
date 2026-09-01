import type { Metadata } from "next";
import { Grid, gutterClass } from "@/components/layout/grid";
import AgentGuide from "@/components/mcp/agent-guide";
import AgentPicker from "@/components/mcp/agent-picker";
import Block from "@/components/mcp/block";
import CodeBlock from "@/components/mcp/code-block";
import { Code } from "@/components/mcp/inline";
import { agents } from "@/data/agents";
import { inspectorCommand, mounts, IS_LOCAL } from "@/data/mcp";

export const metadata: Metadata = {
  title: "Quickstart — agoramcp",
  description:
    "Connect Claude, Codex, Cursor, Windsurf or VS Code to Greek open government data — one address, in about a minute.",
};

export default function QuickstartPage() {
  const country = mounts[0];

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The landing page's hero shape: a band tall enough to stand on its
          own, copy centred on the left columns and the right ones carrying the
          eye. The picker stands where the shader does over there. Column
          starts are declared here, so the Grid's own inset stays off. */}
      <header className="mb-20 flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <p className="text-[10px] tracking-[0.3em] text-accent uppercase">
              Quickstart
            </p>
            <h1 className="mt-4 text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              Connected in a minute.
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Pick the agent you already work in and paste one address into it.
              Every client takes the same server; only where you paste it
              differs — some through their own interface, some through a file.
              There is no SDK, no account and nothing to install.
            </p>
            <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
              Every snippet below connects to the country server at{" "}
              <Code>{country.path}</Code>, which answers for every Greek
              registry agoramcp mounts. For a single registry, swap the address
              for <Code>{mounts[1].path}</Code> — nothing else about the entry
              changes.
            </p>
          </div>

          <div className="col-span-12 col-start-1 mt-10 md:col-span-6 md:col-start-7 md:mt-0 md:self-center">
            <AgentPicker />
          </div>
        </Grid>
      </header>

      <Grid inset={false}>
        <div className="col-span-12 col-start-1 flex flex-col gap-10 md:col-span-8">
          {agents.map((agent) => (
            <AgentGuide key={agent.id} agent={agent} mount={country} />
          ))}
        </div>

        <div className="col-span-12 col-start-1 mt-10 border-t border-panel-border/50 pt-6 md:col-span-8">
          <Block
            title="Check the setup"
            note="The official inspector, from the terminal rather than the client. It lists the tools the server is offering, which is the same list the model will see once it connects."
          >
            <CodeBlock
              code={inspectorCommand(country)}
              label="the inspector command"
            />
          </Block>
        </div>

        {IS_LOCAL && (
          <p className="col-span-12 col-start-1 mt-3 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
            <span className="text-foreground">These addresses are local.</span>{" "}
            The server runs on your own machine for now — <Code>pnpm dev</Code>{" "}
            in the repository starts it on port 3000 — so a client can only
            reach it from there. Hosted addresses are coming, and when they land
            the only thing that changes in these snippets is the URL.
          </p>
        )}
      </Grid>
    </main>
  );
}
