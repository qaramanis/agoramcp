import Section from "@/components/layout/grid";
import QuestionTabs from "./question-tabs";

/**
 * A question, worked. The hero promises one can be asked; this is what
 * answering it looks like. The use-case pages own the full walkthrough and
 * /live owns the real response — this points at both.
 *
 * The copy is handed to the tabs so it stays server-rendered; it lives in
 * their left column because the panel on the right is centred against the
 * whole of that column, heading included.
 */
export default function WorkedQuestion() {
  return (
    <Section
      ariaLabel="Questions"
      className="flex min-h-screen flex-col justify-center"
    >
      {/* Ten columns, and the tabs divide them ten ways — four for the
          list, one of air, five for the panel, on the page's own columns. */}
      <div className="col-span-12 md:col-span-10">
        <QuestionTabs
          header={
            <>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Questions
              </h2>
              <p className="mt-3 text-[13px] text-muted-foreground">
                One prompt to your agent, the tools it calls in order, and the
                registries that answer it.
              </p>
            </>
          }
        />
      </div>
    </Section>
  );
}
