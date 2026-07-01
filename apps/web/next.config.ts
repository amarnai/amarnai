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
  // The full Content-Security-Policy (including `frame-ancestors 'none'`) is built
  // per request in src/proxy.ts because it carries a per-request nonce. X-Frame-Options
  // stays here as the static clickjacking fallback for asset routes the proxy matcher
  // skips and for browsers that don't honour `frame-ancestors`.
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
    ];

    // Strict-Transport-Security forces HTTPS on subsequent visits and blocks
    // protocol-downgrade attacks. Browsers only honor it on HTTPS responses, so
    // it is gated to production to avoid caching a policy against local HTTP dev.
    // Host-scoped on purpose: no `includeSubDomains` (a self-hoster may run
    // non-TLS sibling services on the same parent domain) and no `preload` (a
    // hard-to-reverse commitment). Hosted deployments can widen this at the edge.
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000",
      });
    }

    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
