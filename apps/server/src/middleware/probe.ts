import { PROBE_HEADER, PROXY_HEADER, secretMatches } from "@agoramcp/core";
import type { MiddlewareHandler } from "hono";

/**
 * What a call marked as the status monitor's may be.
 *
 * - `fresh`: marked, and proven to come from the web app by `PROXY_SECRET`.
 *   It reads nothing from the cache — so the check reaches the registry
 *   rather than answering from what an earlier call left — though what it
 *   fetches is still written back for the next caller. It is not recorded:
 *   the monitor writes its own row.
 * - `marked`: marked, on a server with no `PROXY_SECRET` to check the mark
 *   against. Not recorded, as before there was a secret to check; read from
 *   the cache like any call, since nothing proves who is asking.
 *
 * A mark without the proof on a server that has the secret is not a probe
 * at all: it is recorded and cached like any call, so the header can neither
 * hide calls from the status history nor be used to get past the cache.
 */
export type ProbeMode = "fresh" | "marked";

declare module "hono" {
  interface ContextVariableMap {
    probe?: ProbeMode;
  }
}

export function probeMode(proxySecret: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header(PROBE_HEADER) !== undefined) {
      if (!proxySecret) {
        c.set("probe", "marked");
      } else if (secretMatches(c.req.header(PROXY_HEADER), proxySecret)) {
        c.set("probe", "fresh");
      } else {
        c.get("logger").warn("probe.unproven", { path: c.req.path });
      }
    }
    await next();
  };
}
