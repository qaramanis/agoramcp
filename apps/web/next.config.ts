import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Everything the site loads is its own: fonts self-hosted by `next/font`,
 * images from `public/`, Vercel Web Analytics from `/_vercel/insights` on
 * this origin, and the /live console's calls to `/api/mcp`. So the policy
 * names no other origin, and nothing else can be loaded, framed or posted to.
 *
 * Inline scripts are allowed: the App Router streams its payload in them,
 * and the alternative, a nonce per request, would render every page
 * dynamically. What this gives up is protection from a script injected into
 * the page itself, and the site renders no one else's HTML. Development adds
 * what React's dev build evaluates and the analytics debug script, which is
 * served from Vercel's CDN rather than this origin.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * On every response. HSTS is not here because Vercel already sends it,
 * two years with `includeSubDomains` and `preload`.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // For browsers that predate `frame-ancestors`.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Workspace packages export their TypeScript source; Next compiles it with the app.
  transpilePackages: ["@agoramcp/core"],
  // Says nothing a visitor needs, and tells a scanner what to try.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
