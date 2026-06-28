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
};

export default config;
