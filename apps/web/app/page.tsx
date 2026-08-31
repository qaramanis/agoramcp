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
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
          <p className="mt-3 max-w-md text-[13px] text-muted-foreground">
            Placeholder section. Content lands once the servers are built.
          </p>
        </Section>
      ))}
    </main>
  );
}
