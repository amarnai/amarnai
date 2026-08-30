import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  ignores: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/*.config.*",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", {
      varsIgnorePattern: "^_",
      argsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
    }],
  },
},
// Enforce that the AI package never imports from the database layer.
// AI functions must receive data as typed arguments — no direct DB access.
// This prevents prompt-injection attacks from being able to query or leak
// data belonging to other users or workspaces.
{
  files: ["packages/ai/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["@aziru/db", "@aziru/db/*"],
          message: "packages/ai must not import from the database layer. Receive data as typed function arguments instead.",
        },
        {
          group: ["@prisma/client", "@prisma/client/*"],
          message: "packages/ai must not import Prisma directly. Receive data as typed function arguments instead.",
        },
      ],
    }],
  },
},
// Enforce that @aziru/core stays platform-agnostic. It is the shared
// view-model tier consumed by BOTH the web app (DOM) and the mobile app
// (React Native). Plain `react` (hooks/context) is reconciler-agnostic and
// identical on both platforms, so shared hooks may use it. What it must never
// import is a renderer (react-dom), a framework (next), a platform UI runtime
// (react-native/expo), or the web-only UI package (@aziru/ui).
{
  files: ["packages/core/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["react-dom", "react-dom/*"],
          message: "packages/core must not import react-dom (web renderer). Use plain `react` hooks only; rendering belongs in the app.",
        },
        {
          group: ["next", "next/*"],
          message: "packages/core must not depend on Next.js. It is shared with the React Native app.",
        },
        {
          group: ["react-native", "react-native/*", "expo", "expo/*", "expo-*"],
          message: "packages/core must not depend on React Native/Expo. It is shared with the web app.",
        },
        {
          group: ["@aziru/ui", "@aziru/ui/*"],
          message: "packages/core must not import @aziru/ui (web-only rendering). Dependency direction is ui -> core, never the reverse.",
        },
      ],
    }],
  },
},
// Enforce that the mobile app never imports the web-only UI package or any
// server-only package. Mobile is a React Native client: it talks to the API
// through @aziru/api-client and reuses @aziru/core / @aziru/shared /
// @aziru/tokens only. A server-only import (db, ai, queue, gmail, config)
// would pull Node-only code into the bundle and leak server concerns onto a
// shipped device.
{
  files: ["apps/mobile/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["@aziru/ui", "@aziru/ui/*"],
          message: "apps/mobile must not import @aziru/ui (web/DOM rendering). Build screens from React Native primitives styled with @aziru/tokens, driven by @aziru/core.",
        },
        {
          group: [
            "@aziru/db", "@aziru/db/*",
            "@aziru/ai", "@aziru/ai/*",
            "@aziru/queue", "@aziru/queue/*",
            "@aziru/gmail", "@aziru/gmail/*",
            "@aziru/config", "@aziru/config/*",
            "@prisma/client", "@prisma/client/*",
          ],
          message: "apps/mobile must not import server-only packages. Reach the backend through @aziru/api-client instead.",
        },
      ],
    }],
  },
});
