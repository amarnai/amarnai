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
          group: ["@amarnai/db", "@amarnai/db/*"],
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
// Enforce that @amarnai/core stays platform-agnostic. It is the shared
// view-model tier consumed by BOTH the web app (DOM) and the mobile app
// (React Native). Plain `react` (hooks/context) is reconciler-agnostic and
// identical on both platforms, so shared hooks may use it. What it must never
// import is a renderer (react-dom), a framework (next), a platform UI runtime
// (react-native/expo), or the web-only UI package (@amarnai/ui).
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
          group: ["@amarnai/ui", "@amarnai/ui/*"],
          message: "packages/core must not import @amarnai/ui (web-only rendering). Dependency direction is ui -> core, never the reverse.",
        },
      ],
    }],
  },
});
