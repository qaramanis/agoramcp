import type { ReactNode } from "react";
import CodeBlock from "@/components/mcp/code-block";
import { MCP_BASE_URL } from "@/data/mcp";

/**
 * Where a country or a source answers, both ways in: the MCP mount and the
 * HTTP API root, each copyable. The same label-over-block stack the /api hero
 * uses for its first request.
 */
export default function Addresses({
  endpoint,
  api,
  note,
}: {
  /** Mount path on the MCP server. */
  endpoint: string;
  /** Root of the HTTP API. */
  api: string;
  /** One line under the addresses, when there is something to say about them. */
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] text-muted">MCP server</p>
        <div className="mt-2">
          <CodeBlock code={`${MCP_BASE_URL}${endpoint}`} label="the MCP address" />
        </div>
      </div>
      <div>
        <p className="text-[11px] text-muted">HTTP API</p>
        <div className="mt-2">
          <CodeBlock code={`${MCP_BASE_URL}${api}`} label="the API address" />
        </div>
      </div>
      {note && <p className="text-[11px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}
