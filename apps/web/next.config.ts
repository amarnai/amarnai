import type { NextConfig } from "next";
import path from "path";

const config: NextConfig = {
  output: "standalone",
  // Trace files relative to the monorepo root so workspace packages are included.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  devIndicators: false,
  transpilePackages: ["@amarnai/core", "@amarnai/db", "@amarnai/email", "@amarnai/i18n", "@amarnai/ui"],
  serverExternalPackages: ["@prisma/client", "ioredis", "nodemailer", "resend"],
  experimental: {
    swcPlugins: [["@lingui/swc-plugin", {}]],
  },
  // When transpiling workspace packages that use NodeNext-style `.js` extensions
  // for TypeScript source files, the bundler must resolve `.js` to `.ts`/`.tsx`.
  // Turbopack has no `extensionAlias` equivalent yet (vercel/next.js#82945), so
  // dev/build run with the `--webpack` flag (see package.json scripts) and this applies.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  // The taxonomy page moved from /plan to /folders when the feature was renamed.
  // Kept indefinitely: extension builds already installed link to /plan by
  // absolute URL, and they update on the store's schedule, not ours.
  async redirects() {
    return [{ source: "/plan", destination: "/folders", permanent: true }];
  },
  // The full Content-Security-Policy (including `frame-ancestors 'none'`) is built
  // per request in src/proxy.ts because it carries a per-request nonce. X-Frame-Options
  // stays here as the static clickjacking fallback for asset routes the proxy matcher
  // skips and for browsers that don't honour `frame-ancestors`.
  async headers() {
    // Strict-Transport-Security forces HTTPS on subsequent visits and blocks
    // protocol-downgrade attacks. Browsers only honor it on HTTPS responses, so
    // it is gated to production to avoid caching a policy against local HTTP dev.
    // Host-scoped on purpose: no `includeSubDomains` (a self-hoster may run
    // non-TLS sibling services on the same parent domain) and no `preload` (a
    // hard-to-reverse commitment). Hosted deployments can widen this at the edge.
    const transportHeaders =
      process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000" }]
        : [];

    return [
      // X-Frame-Options everywhere EXCEPT the Outlook task pane, which Outlook
      // must be able to frame. The header has no allowlist form, so the pane is
      // excluded here and protected instead by the per-request `frame-ancestors`
      // in csp.ts, which names the Outlook hosts explicitly. Excluded
      // unconditionally rather than behind OUTLOOK_ADDIN_ENABLED: with the flag
      // off the route 404s, so there is nothing to frame either way, and this
      // config is evaluated at build time where a runtime flag is not reliable.
      {
        source: "/((?!outlook-panel).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      ...(transportHeaders.length
        ? [{ source: "/:path*", headers: transportHeaders }]
        : []),
    ];
  },
};

export default config;
