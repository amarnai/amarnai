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
});
