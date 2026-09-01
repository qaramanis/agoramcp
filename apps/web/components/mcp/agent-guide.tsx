import { ArrowUpRight } from "lucide-react";
import { columnGapClass } from "@/components/layout/grid";
import type { Agent } from "@/data/agents";
import { IS_LOCAL, mountUrl, type Mount } from "@/data/mcp";
import CodeBlock from "./code-block";
import { Ticks } from "./inline";

/**
 * One client's instructions. The app's own interface comes first where it has
 * one — it is the shorter route, and the reader who wants a file is already
 * looking for the file.
 *
 * Eight columns carrying the page's gaps: the guide list is given eight of the
 * page's twelve, so a column in here is a column out there and the prose keeps
 * its measure from the grid rather than from a max-width of its own.
 */
export default function AgentGuide({
  agent,
  mount,
}: {
  agent: Agent;
  mount: Mount;
}) {
  return (
    <section
      id={`connect-${agent.id}`}
      aria-label={`Connect ${agent.name}`}
      // Clears the fixed navigation when the picker jumps here.
      className={`grid scroll-mt-28 grid-cols-8 border-t border-panel-border/50 pt-6 ${columnGapClass}`}
    >
      <div className="col-span-8 col-start-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[14px] font-medium tracking-wide text-foreground">
          {agent.name}
        </h3>
        <a
          href={agent.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[11px] text-muted transition-colors duration-300 hover:text-accent"
        >
          {agent.name} official docs
          <ArrowUpRight size={11} className="shrink-0" />
        </a>
      </div>

      <p className="col-span-8 col-start-1 mt-2 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
        <Ticks text={agent.summary} />
      </p>

      {/* A client that takes the address through its own interface has no
          snippet to carry it, so the address would never appear on its card.
          Hand it over on its own, above the caveats about where it can point. */}
      {!agent.configs && (
        <div className="col-span-8 col-start-1 mt-3">
          <CodeBlock code={mountUrl(mount)} label="the server URL" />
        </div>
      )}

      {agent.needsPublicUrl && (
        <p className="col-span-8 col-start-1 mt-3 text-[12px] leading-relaxed text-warn md:col-span-6">
          This one connects from its own cloud rather than from the machine you
          are reading this on, so the address has to be reachable over the
          public internet.
          {IS_LOCAL && " A local address will not resolve for it yet."}
        </p>
      )}

      {agent.ui && (
        <div className="col-span-8 col-start-1 mt-4 md:col-span-6">
          <p className="text-[12px] text-foreground">{agent.ui.title}</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {agent.ui.steps.map((step, index) => (
              <li
                key={step}
                className="flex gap-2.5 text-[12px] leading-relaxed text-muted-foreground"
              >
                <span className="shrink-0 text-muted tabular-nums">{`${index + 1}.`}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {agent.configs?.map((config) => (
        <div key={config.title} className="col-span-8 col-start-1 mt-4">
          <p className="text-[11px] text-muted">{config.title}</p>
          <div className="mt-2">
            <CodeBlock
              code={config.code(mount)}
              label={`the ${agent.name} ${config.title} snippet`}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
