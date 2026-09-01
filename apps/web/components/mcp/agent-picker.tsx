import Image from "next/image";
import Link from "next/link";
import { columnGapClass } from "@/components/layout/grid";
import { agents, type Agent } from "@/data/agents";

interface AgentPickerProps {
  /**
   * Page the instructions live on. Empty means this page, and the rows stay
   * plain anchors so the browser does its own smooth scroll; set it and they
   * become client-side links to that page's matching block.
   */
  hrefBase?: string;
}

/**
 * The mark on its tile. Publisher marks arrive black on transparent, so the
 * same treatment the source grid gives its logos applies here: grayscale and
 * a per-logo invert flatten them into one set, and they only come up to full
 * strength on hover.
 */
function AgentMark({ agent }: { agent: Agent }) {
  if (!agent.logo) return null;

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-panel-border bg-panel transition-colors duration-300 group-hover:border-accent/50">
      <Image
        src={agent.logo}
        alt=""
        width={20}
        height={20}
        unoptimized
        className={`h-5 w-5 object-contain opacity-70 grayscale transition-opacity duration-300 group-hover:opacity-100 ${
          agent.invert ? "invert" : ""
        }`}
      />
    </span>
  );
}

/**
 * Jumps to a client's instructions. Anchors rather than buttons, so they need
 * no JavaScript, survive a middle click, and leave a linkable hash behind.
 *
 * Mark-and-name rows rather than a row of chips: it is the block that sits
 * beside the hero copy, so it wants height rather than width.
 *
 * Six columns carrying the page's own gaps, so however many of them a row is
 * dealt into, the tiles land on the page's twelve — the hero gives this block
 * six of them, which makes one column here one column there. How many fit a
 * row is the only thing a breakpoint decides: the widest name, "Any MCP
 * client", does not clear a third of the block until lg.
 */
export default function AgentPicker({ hrefBase = "" }: AgentPickerProps) {
  return (
    <nav
      aria-label="Jump to a client"
      className={`grid grid-cols-6 gap-y-3 ${columnGapClass}`}
    >
      {agents.map((agent) => {
        const href = `${hrefBase}#connect-${agent.id}`;
        const className =
          "group col-span-6 flex items-center gap-3 md:col-span-3 lg:col-span-2";

        const content = (
          <>
            <AgentMark agent={agent} />
            <span className="text-[13px] whitespace-nowrap text-muted-foreground transition-colors duration-300 group-hover:text-foreground">
              {agent.name}
            </span>
          </>
        );

        return hrefBase ? (
          <Link key={agent.id} href={href} className={className}>
            {content}
          </Link>
        ) : (
          <a key={agent.id} href={href} className={className}>
            {content}
          </a>
        );
      })}
    </nav>
  );
}
