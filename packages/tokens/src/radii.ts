// Border radius values in pixels — consumable by CSS (via `${r}px`) and RN StyleSheet.
export const radii = {
  sm: 8,      // --r-sm
  md: 12,     // --r-md
  lg: 16,     // --r-lg
  xl: 22,     // --r-xl
  full: 9999, // --r-full — pills and circles
} as const;

export type RadiusToken = keyof typeof radii;
