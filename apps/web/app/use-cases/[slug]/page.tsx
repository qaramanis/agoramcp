import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Grid, gutterClass } from "@/components/layout/grid";
import Band from "@/components/mcp/band";
import Block from "@/components/mcp/block";
import CodeBlock from "@/components/mcp/code-block";
import { Code } from "@/components/mcp/inline";
import { casePath, findUseCase, useCases } from "@/data/use-cases";

/** The use cases are local data, so every page is built once, at build time. */
export function generateStaticParams() {
  return useCases.map((useCase) => ({ slug: useCase.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/use-cases/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) return { title: "Not a use case — agoramcp" };
  return { title: `${useCase.title} — agoramcp`, description: useCase.summary };
}

export default async function UseCasePage({
  params,
}: PageProps<"/use-cases/[slug]">) {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) notFound();

  const others = useCases.filter((entry) => entry.slug !== useCase.slug);

  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      {/* The /api hero's shape: copy on the left five columns, the thing
          itself on the right six. Here the thing is the question. */}
      <header className="flex min-h-[70vh] items-center">
        <Grid inset={false} className="w-full items-center gap-y-10">
          <div className="col-span-12 col-start-1 md:col-span-5">
            <h1 className="text-[2.5rem] leading-[1.2] font-medium tracking-tight text-foreground">
              {useCase.title}
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              {useCase.blurb}
            </p>
          </div>

          <div className="col-span-12 col-start-1 md:col-span-6 md:col-start-7">
            <p className="text-[11px] text-muted">Ask your agent</p>
            <div className="mt-2">
              <CodeBlock code={useCase.prompt} label="the prompt" wrap />
            </div>
          </div>
        </Grid>
      </header>

      <Band title="How it answers.">
        <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
          The model picks the tools and the order itself. This is the path it
          takes, and the tools are named as they go over the wire — each one is
          in the catalogue, with its arguments and an example it ships with.
        </p>

        <ol className="col-span-8 col-start-1 mt-8 flex flex-col gap-10">
          {useCase.steps.map((step) => (
            <li key={step.tool}>
              <Block title={step.title} note={step.body}>
                <Code>{step.tool}</Code>
              </Block>
            </li>
          ))}
        </ol>
      </Band>

      <Band title="The registries behind it.">
        <p className="col-span-8 col-start-1 mt-3 text-[13px] leading-relaxed text-muted-foreground md:col-span-6">
          Official publishers, unmodified. Each answer carries the licence and
          the attribution its registry asks for, and every tool above is listed
          on the source&apos;s own page.
        </p>

        {useCase.sources.map((source) => (
          <Link
            key={source.id}
            href={`/all/${source.country}/${source.id}`}
            className="group col-span-8 col-start-1 mt-6 flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 hover:text-accent md:col-span-3"
          >
            {source.name}
            <ArrowUpRight size={12} className="shrink-0" />
          </Link>
        ))}
      </Band>

      <Band title="Ask it yourself.">
        {ASK.map((exit) => (
          <Link
            key={exit.href}
            href={exit.href}
            className="group col-span-8 col-start-1 mt-8 flex flex-col gap-1 md:col-span-3"
          >
            <span className="flex items-center gap-1 text-[13px] text-foreground transition-colors duration-300 group-hover:text-accent">
              {exit.title}
              <ArrowUpRight size={12} className="shrink-0" />
            </span>
            <span className="text-[12px] leading-relaxed text-muted-foreground">
              {exit.description}
            </span>
          </Link>
        ))}

        {/* No index page to go back to, so the other questions sit here —
            the same shape as the tool index on a source's page. */}
        <ul className="col-span-8 col-start-1 mt-12 flex flex-wrap gap-x-4 gap-y-1.5">
          {others.map((other) => (
            <li key={other.slug}>
              <Link
                href={casePath(other.slug)}
                className="text-[11px] text-muted-foreground transition-colors duration-300 hover:text-accent"
              >
                {other.title}
              </Link>
            </li>
          ))}
        </ul>
      </Band>
    </main>
  );
}

/** The two ways to put the question to the tools for real. */
const ASK: { title: string; description: string; href: string }[] = [
  {
    title: "Connect your client",
    description: "One command or one config entry, then ask in your own words.",
    href: "/quickstart",
  },
  {
    title: "Try a call in the browser",
    description: "Pick a tool, edit the arguments, read the real response.",
    href: "/live",
  },
];
