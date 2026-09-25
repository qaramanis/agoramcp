import { PROXY_HEADER, REQUESTER_HEADER, requesterId } from "@agoramcp/core/requester";
import { headers } from "next/headers";

/**
 * Who is asking, as `requesterId` defines it for the whole system: a keyed
 * hash of the client's address, the same one the MCP server's rate limiter
 * counts. Stable enough that one person counts once per country, opaque
 * enough that the table holds no address. Keep `REQUEST_HASH_SALT` the same
 * across deployments and on both apps, or every visitor becomes new — and
 * can ask twice.
 */
export async function requesterHash(): Promise<string> {
  const salt = process.env.REQUEST_HASH_SALT;
  if (!salt) throw new Error("REQUEST_HASH_SALT is not set.");
  return requesterId(await clientAddress(), salt);
}

/**
 * What the /live proxy sends the MCP server so the rate limit counts the
 * visitor rather than this app: the visitor's `requesterId`, and the secret
 * that lets the server believe it. Without both variables it sends nothing,
 * and the server counts the app's own address, as it would any caller.
 */
export async function proxyHeaders(): Promise<Record<string, string>> {
  const secret = process.env.PROXY_SECRET;
  const salt = process.env.REQUEST_HASH_SALT;
  if (!secret || !salt) return {};
  return { [PROXY_HEADER]: secret, [REQUESTER_HEADER]: requesterId(await clientAddress(), salt) };
}

/** Vercel and any proxy put the client first in the chain. */
async function clientAddress(): Promise<string> {
  const incoming = await headers();
  return incoming.get("x-forwarded-for")?.split(",")[0]?.trim() || incoming.get("x-real-ip") || "unknown";
}
