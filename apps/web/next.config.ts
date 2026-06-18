import type { NextConfig } from "next";
import path from "path";

const config: NextConfig = {
  output: "standalone",
  // Trace files relative to the monorepo root so workspace packages are included.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  devIndicators: false,
  transpilePackages: ["@amarnai/core", "@amarnai/db", "@amarnai/ui"],
  serverExternalPackages: ["@prisma/client", "ioredis"],
  webpack: (config) => {
    // When transpiling workspace packages that use NodeNext-style `.js` extensions
    // for TypeScript source files, Webpack needs to know that `.js` can resolve to `.ts`.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default config;
