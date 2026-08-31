import type { Metadata } from "next";
import { gutterClass } from "@/components/layout/grid";
import Playground from "@/components/playground/playground";

export const metadata: Metadata = {
  title: "View live — agoramcp",
  description: "Call the mounted MCP tools from the browser and read the real response.",
};

export default function LivePage() {
  return (
    <main className={`min-h-screen pt-28 pb-20 ${gutterClass}`}>
      <header className="mb-8 max-w-2xl">
        <p className="text-[10px] tracking-[0.3em] text-accent uppercase">View live</p>
        <h1 className="mt-4 text-[2rem] leading-[1.2] font-medium tracking-tight text-foreground">
          The tools, live in action.
        </h1>
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          Every available tool an assistant can call is found here. Pick a source, edit the arguments, send
          the call and view the official response.
        </p>
      </header>

      <Playground />
    </main>
  );
}
