import type { SourceMeta } from "@agoramcp/core";

export const meta: SourceMeta = {
  name: "Walking skeleton",
  description:
    "Scaffolding source with no upstream. Exists to prove the transport, the registry and the tool plumbing end to end. Delete once a real source is mounted.",
  publisher: "agoramcp",
  upstreamUrl: "https://github.com/qaramanis/agoramcp",
  license: "MIT",
  attribution: "agoramcp",
  ttl: {
    default: 0,
  },
};
