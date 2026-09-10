import Section, { columnGapClass } from "@/components/layout/grid";
import Output from "@/components/mcp/output";
import { allSources, loadLicenses, type LicenseSource } from "@/data/licenses";

/**
 * Why the data can be trusted, in three facts. The detail lives elsewhere and
 * the nav gets you there: the catalogue names every publisher, the licences
 * page says what each licence asks, and the status page says who is answering.
 *
 * The same shape as Questions — heading, subtext and two of the facts on four
 * of the page's columns, one of air, and the licence fact with its envelope on
 * the last five, the two cells centred against each other in a full-height
 * band — so the two sections read as one page.
 *
 * The envelope excerpt is the registry's, read the way the licences page
 * reads it: the attribution line verbatim, in the script the publisher
 * wrote it in, because that is the string that goes over the wire. With the
 * server unreachable the fact stands without its example.
 */
export default async function Attribution() {
  const { groups } = await loadLicenses();
  const sources = allSources(groups);
  // Diavgeia is the source the /api page's captured response comes from, so
  // the line here matches the one there; any mounted source would do.
  const example = sources.find((source) => source.id === "diavgeia") ?? sources[0];

  return (
    <Section
      ariaLabel="Attribution"
      className="flex min-h-screen flex-col justify-center"
    >
      <div className="col-span-12 md:col-span-10">
        <div className={`grid grid-cols-10 items-center gap-y-10 ${columnGapClass}`}>
          <div className="col-span-10 md:col-span-4">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Attribution
            </h2>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Nothing here is ours. Every record arrives from an official
              registry under the registry&apos;s own terms, and those terms
              come with it.
            </p>

            <div className="mt-8 flex flex-col gap-8">
              <Fact
                title="Official registries only"
                body="Every source is a public body's own register, reached at its own address. Each one names its publisher and where it lives, and the tools return its records as published."
              />

              <Fact
                title="Answering right now"
                body="A registry that is down is a question that goes unanswered. Each one is checked with a real call through the same door you use, and the result is on one page."
              />
            </div>
          </div>

          <div className="col-span-10 md:col-span-5 md:col-start-6">
            <Fact
              title="The licence travels with the data"
              body="Every response carries the registry's licence and the line it asks you to show beside the data. This is how it arrives:"
            >
              {example && <Output code={envelope(example)} />}
            </Fact>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** One fact: title, a sentence or two, and whatever it shows. */
function Fact({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[13px] text-foreground">{title}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/**
 * The envelope every HTTP response wraps `data` in (`apps/server/src/api.ts`),
 * trimmed to the fields this section is about. `JSON.stringify` on each
 * value, so a quote in a publisher's own wording is escaped the way the
 * server escapes it.
 */
function envelope(source: LicenseSource): string {
  return [
    "{",
    `  "source": ${JSON.stringify(source.id)},`,
    `  "license": ${JSON.stringify(source.license)},`,
    `  "attribution": ${JSON.stringify(source.attribution)},`,
    '  "data": { … }',
    "}",
  ].join("\n");
}
