import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@amarnai/db"],
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
