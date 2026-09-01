/**
 * Where the MCP server answers, and the mounts a client can point at.
 *
 * Every address on the page and in every snippet is built from `MCP_BASE_URL`,
 * so deploying the server changes the host in one place. It is inlined at
 * build time, which is what lets the snippets be server-rendered.
 */
export const MCP_BASE_URL =
  process.env.NEXT_PUBLIC_MCP_BASE_URL ?? "http://localhost:3000";

/**
 * True while the addresses point at a machine only the reader has. The page
 * says so plainly rather than pretending the snippets work for a visitor —
 * and stops saying it the moment the host changes.
 */
export const IS_LOCAL =
  MCP_BASE_URL.includes("localhost") || MCP_BASE_URL.includes("127.0.0.1");

export type Mount = {
  /** The address shape, placeholders in braces. */
  pattern: string;
  /** The live example of that shape. */
  path: string;
  /** What a client files the server under, and how a model then prefixes it. */
  clientName: string;
  label: string;
};

/**
 * Country first: it is the mount to reach for before you know which registry
 * holds what. The server mounts both — see `apps/server/src/index.ts`.
 */
export const mounts: Mount[] = [
  {
    pattern: "/{country}/mcp",
    path: "/gr/mcp",
    clientName: "greece",
    label: "A whole country",
  },
  {
    pattern: "/{country}/mcp/{source}",
    path: "/gr/mcp/diavgeia",
    clientName: "diavgeia",
    label: "One source",
  },
];

export function mountUrl(mount: Mount): string {
  return `${MCP_BASE_URL}${mount.path}`;
}

/** Verified against the installed CLI: `claude mcp add --help`. */
export function addCommand(mount: Mount): string {
  return `claude mcp add --transport http ${mount.clientName} ${mountUrl(mount)}`;
}

/**
 * The `mcpServers` entry every other client keeps some version of. Where the
 * file lives differs per client; the entry does not.
 */
export function clientConfig(mount: Mount): string {
  return JSON.stringify(
    { mcpServers: { [mount.clientName]: { type: "http", url: mountUrl(mount) } } },
    null,
    2,
  );
}

/** The official inspector, in the same one-liner form the README uses. */
export function inspectorCommand(mount: Mount): string {
  return [
    `npx @modelcontextprotocol/inspector --cli ${mountUrl(mount)} \\`,
    `  --transport http --method tools/list`,
  ].join("\n");
}
