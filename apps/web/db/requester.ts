import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Who is asking, without an account: a salted SHA-256 of the client address
 * and user agent. Stable enough that one person counts once per country,
 * opaque enough that the table holds no address. The salt is what stops the
 * hash being reversed by hashing candidate addresses — keep it the same
 * across deployments, or every visitor becomes new and can ask twice.
 */
export async function requesterHash(): Promise<string> {
  const salt = process.env.REQUEST_HASH_SALT;
  if (!salt) throw new Error("REQUEST_HASH_SALT is not set.");

  const incoming = await headers();
  // Vercel and any proxy put the client first in the chain.
  const address =
    incoming.get("x-forwarded-for")?.split(",")[0]?.trim() || incoming.get("x-real-ip") || "unknown";
  const agent = incoming.get("user-agent") ?? "";

  return createHash("sha256").update(`${salt}\n${address}\n${agent}`).digest("hex");
}
