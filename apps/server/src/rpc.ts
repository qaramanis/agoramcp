import type { RpcSummary } from "./middleware/logging.ts";

/**
 * What the request line needs from a JSON-RPC body, read without the SDK.
 * The transport parses the same body a moment later and refuses what is
 * malformed, so this only has to be lenient: a shape it does not recognise
 * is simply no summary.
 */
export function summariseRpc(body: unknown): RpcSummary | undefined {
  if (Array.isArray(body)) {
    const methods = [...new Set(body.map(methodOf).filter((method) => method !== undefined))];
    return methods.length === 0 ? undefined : { method: methods.join(","), batch: body.length };
  }

  if (!isRecord(body) || typeof body.method !== "string") return undefined;

  const summary: RpcSummary = { method: body.method };
  if (typeof body.id === "string" || typeof body.id === "number") summary.id = body.id;

  if (body.method === "initialize") {
    const params = isRecord(body.params) ? body.params : {};
    const info = isRecord(params.clientInfo) ? params.clientInfo : {};
    if (typeof info.name === "string") {
      summary.client = { name: info.name, version: typeof info.version === "string" ? info.version : "" };
    }
    if (typeof params.protocolVersion === "string") summary.protocolVersion = params.protocolVersion;
  }

  return summary;
}

/**
 * The tool a single `tools/call` names, as registered on the mount it was
 * sent to — qualified on a country server, bare on a source's own. A batch
 * is left alone: one line cannot name several calls.
 */
export function calledToolName(body: unknown): string | undefined {
  if (!isRecord(body) || body.method !== "tools/call") return undefined;
  const params = isRecord(body.params) ? body.params : {};
  return typeof params.name === "string" ? params.name : undefined;
}

function methodOf(message: unknown): string | undefined {
  return isRecord(message) && typeof message.method === "string" ? message.method : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
