import Attribution from "@/components/attribution/attribution";
import Exit from "@/components/exit/exit";
import Hero from "@/components/hero/hero";
import SourceGrid from "@/components/sources/source-grid";
import WorkedQuestion from "@/components/use-cases/worked-question";

/**
 * Rendered per request, for the reason /all gives: the source count is the
 * MCP server's, and a page built when the server was down would carry that
 * answer for good. The read itself is cached for a minute.
 */
export const revalidate = 0;

export default function Page() {
  return (
    <main>
      <Hero />

      <SourceGrid />

      <WorkedQuestion />

      <Attribution />

      <Exit />
    </main>
  );
}
