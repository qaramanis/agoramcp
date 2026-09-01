import { columnGapClass } from "@/components/layout/grid";
import { Code } from "@/components/mcp/inline";
import Output from "@/components/mcp/output";
import type { DirectoryTool } from "@/data/directory";

/**
 * One tool, in full: the description a model is given, every argument with its
 * type and bounds, and the example the tool ships with. Anchored on the tool's
 * name so the index above the list, and links from elsewhere, land on it.
 */
export default function ToolReference({ tool }: { tool: DirectoryTool }) {
  const hasExample = Object.keys(tool.example).length > 0;

  return (
    <article
      id={tool.name}
      aria-label={tool.name}
      className={`grid grid-cols-8 scroll-mt-28 border-t border-panel-border/50 pt-8 ${columnGapClass}`}
    >
      <header className="col-span-8 col-start-1">
        <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Code>{tool.name}</Code>
          {" >"}
          <span className="text-[12px] text-muted-foreground">
            {tool.title}
          </span>
        </h3>
      </header>

      <p className="col-span-8 col-start-1 mt-3 text-[12px] leading-relaxed text-muted-foreground md:col-span-6">
        {tool.description}
      </p>

      <div className="col-span-8 col-start-1 mt-6 md:col-span-6">
        <p className="text-[12px] text-foreground">Arguments</p>
        {tool.arguments.length === 0 ? (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            None. Call it with an empty object.
          </p>
        ) : (
          <dl className="mt-3 flex flex-col gap-4">
            {tool.arguments.map((argument) => (
              <div key={argument.name}>
                <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Code>{argument.name}</Code>
                  <span className="text-[11px] text-muted">
                    {argument.type}
                    {argument.constraint ? `, ${argument.constraint}` : ""}
                  </span>
                  {argument.required && (
                    <span className="text-[9px] tracking-[0.2em] text-accent uppercase">
                      required
                    </span>
                  )}
                </dt>
                <dd className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {argument.description}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {hasExample && (
        <div className="col-span-8 col-start-1 mt-6 md:col-span-6">
          <p className="text-[12px] text-foreground">Example arguments</p>
          <div className="mt-2">
            <Output code={JSON.stringify(tool.example, null, 2)} />
          </div>
        </div>
      )}
    </article>
  );
}
