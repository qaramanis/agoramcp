import Hero from "@/components/hero/hero";
import SourceGrid from "@/components/sources/source-grid";
import Section from "@/components/layout/grid";

export default function Page() {
  return (
    <main>
      <Hero />

      <SourceGrid />

      {["Tools", "Attribution"].map((title) => (
        <Section
          key={title}
          ariaLabel={title}
          className="flex min-h-screen flex-col justify-center"
        >
          <h2 className="col-span-12 text-2xl font-bold tracking-tight text-foreground md:col-span-10">
            {title}
          </h2>
          <p className="col-span-12 mt-3 text-[13px] text-muted-foreground md:col-span-4">
            Placeholder section. Content lands once the servers are built.
          </p>
        </Section>
      ))}
    </main>
  );
}
