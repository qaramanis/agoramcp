import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export their TypeScript source; Next compiles it with the app.
  transpilePackages: ["@agoramcp/core"],
};

export default nextConfig;
