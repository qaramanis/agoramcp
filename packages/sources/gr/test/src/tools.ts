import { defineTool } from "@agoramcp/core";
import { z } from "zod";

export const ping = defineTool({
  name: "ping",
  title: "Ping",
  description:
    "Health check for the agoramcp transport. Returns the message you send plus the server's clock. Carries no government data — use it only to confirm a connection works.",
  inputSchema: {
    message: z
      .string()
      .max(200)
      .optional()
      .describe("Text echoed back verbatim. Defaults to 'pong'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async handler(input, context) {
    context.logger.debug("ping", { message: input.message });
    return {
      ok: true,
      echo: input.message ?? "pong",
      serverTime: new Date().toISOString(),
    };
  },
});

export const tools = [ping];
