// Font-family stacks for web (CSS) and RN (system fonts).
// React Native ignores font stacks; use individual fontFamily strings there.

type FontStacks = { sans: string; mono: string };
type RnFonts = { sans: string | undefined; mono: string };

export const typography: { web: FontStacks; rn: RnFonts } = {
  // Web CSS font-family stacks (used in var(--f-sans) etc.)
  web: {
    sans: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
    mono: "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace",
  },
  // React Native system fonts
  rn: {
    sans: undefined, // uses system default
    mono: "Menlo",
  },
};
