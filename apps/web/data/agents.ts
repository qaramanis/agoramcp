import { mountUrl, type Mount } from "./mcp";

/**
 * The clients the connect section walks through, and how each one actually
 * takes a Streamable HTTP server.
 *
 * The shapes are not interchangeable — Cursor wants `url`, Windsurf wants
 * `serverUrl`, VS Code wants `servers` with a `type` — so each entry carries
 * its own, and `docsUrl` is where it was checked. Re-check there before
 * editing any of these strings.
 */
export type AgentConfig = {
  /** The file this goes in, or the surface the command is typed at. */
  title: string;
  code: (mount: Mount) => string;
};

export type Agent = {
  /** Also the anchor the picker scrolls to: `#connect-{id}`. */
  id: string;
  name: string;
  /**
   * A mark in `public/logos/agents/`. Absent until we have the publisher's
   * own asset — the row falls back to the wordmark alone, the same bargain
   * the source grid makes.
   */
  logo?: string;
  /** Dark-on-transparent marks need inverting to read on the dark chip. */
  invert?: boolean;
  summary: string;
  /** Steps through the app's own interface, where it has one. */
  ui?: { title: string; steps: string[] };
  configs?: AgentConfig[];
  /**
   * The client reaches the server from a cloud rather than from the machine
   * you are reading this on, so a local address cannot work for it.
   */
  needsPublicUrl?: boolean;
  /** Where these steps were verified. */
  docsUrl: string;
};

/** Pretty-prints a config object the way each client's docs show it. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const agents: Agent[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    logo: "/logos/agents/claude-code.svg",
    invert: true,
    summary:
      "One command, no file to edit. Add `--scope project` to commit the server to the repository instead of your machine.",
    configs: [
      {
        title: "Terminal",
        code: (mount) =>
          `claude mcp add --transport http ${mount.clientName} ${mountUrl(mount)}`,
      },
    ],
    docsUrl: "https://code.claude.com/docs/en/mcp",
  },
  {
    id: "claude",
    name: "Claude",
    logo: "/logos/agents/claude.svg",
    invert: true,
    summary:
      "The web and desktop apps take a URL through Connectors, nothing to install and no file to edit.",
    ui: {
      title: "In the app",
      steps: [
        "Open Customize > Connectors.",
        "Click +, then Add custom connector.",
        "Paste the server URL and click Add.",
      ],
    },
    needsPublicUrl: true,
    docsUrl:
      "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
  {
    id: "codex",
    name: "Codex",
    logo: "/logos/agents/codex.svg",
    invert: true,
    summary:
      "One command, or the same entry written into the config file. A `.codex/config.toml` in a trusted project scopes it to that project.",
    configs: [
      {
        title: "Terminal",
        code: (mount) => `codex mcp add ${mount.clientName} --url ${mountUrl(mount)}`,
      },
      {
        title: "~/.codex/config.toml",
        code: (mount) =>
          [`[mcp_servers.${mount.clientName}]`, `url = "${mountUrl(mount)}"`].join("\n"),
      },
    ],
    docsUrl: "https://developers.openai.com/codex/mcp",
  },
  {
    id: "cursor",
    name: "Cursor",
    logo: "/logos/agents/cursor.svg",
    invert: true,
    summary:
      "The marketplace installs listed servers in one click; anything else goes in the config file. Use `.cursor/mcp.json` in a project to scope it there.",
    configs: [
      {
        title: "~/.cursor/mcp.json",
        code: (mount) =>
          json({ mcpServers: { [mount.clientName]: { url: mountUrl(mount) } } }),
      },
    ],
    docsUrl: "https://cursor.com/docs/context/mcp",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    logo: "/logos/agents/windsurf.svg",
    invert: true,
    summary:
      "Cascade keeps its servers in one file. Note the key: Windsurf calls it `serverUrl`, where everyone else says `url`.",
    ui: {
      title: "In the app",
      steps: [
        "Click the MCPs icon at the top right of the Cascade panel.",
        "Open the raw configuration.",
        "Add the entry below and save.",
      ],
    },
    configs: [
      {
        title: "~/.codeium/windsurf/mcp_config.json",
        code: (mount) =>
          json({ mcpServers: { [mount.clientName]: { serverUrl: mountUrl(mount) } } }),
      },
    ],
    docsUrl: "https://docs.windsurf.com/windsurf/cascade/mcp",
  },
  {
    id: "vscode",
    name: "VS Code",
    logo: "/logos/agents/vscode.svg",
    invert: true,
    summary:
      "Copilot reads a workspace file, or a user-level one through the command palette. The top-level key here is `servers`, not `mcpServers`.",
    ui: {
      title: "In the editor",
      steps: [
        "Open the command palette and run MCP: Add Server.",
        "Choose Workspace or Global.",
        "Pick HTTP and paste the server URL.",
      ],
    },
    configs: [
      {
        title: ".vscode/mcp.json",
        code: (mount) =>
          json({ servers: { [mount.clientName]: { type: "http", url: mountUrl(mount) } } }),
      },
    ],
    docsUrl: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
  },
  {
    id: "direct",
    name: "Any MCP client",
    logo: "/logos/agents/direct.svg",
    invert: true,
    summary:
      "The address is the whole integration. A client none of the entries above cover still takes it — paste it wherever it asks for a Streamable HTTP server, with no command to run and no key to send.",
    configs: [
      {
        title: "Server URL",
        code: (mount) => mountUrl(mount),
      },
    ],
    docsUrl: "https://modelcontextprotocol.io/docs/concepts/transports",
  },
];
