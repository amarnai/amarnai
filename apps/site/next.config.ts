import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@aziru/i18n", "@aziru/ui"],
  experimental: {
    swcPlugins: [["@lingui/swc-plugin", {}]],
  },
  // Workspace packages use NodeNext-style `.js` extensions for TypeScript source,
  // so the bundler must resolve `.js` specifiers to `.ts`/`.tsx`. Turbopack has no
  // `extensionAlias` equivalent yet (vercel/next.js#82945), so dev/build run with
  // the `--webpack` flag (see package.json scripts) and this config applies.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default config;
