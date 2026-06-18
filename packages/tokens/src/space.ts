// Spacing scale in pixels, shared by web (via --space-* CSS vars in globals.css)
// and React Native (StyleSheet numbers). Values mirror the web component metrics
// so the two platforms stay visually coherent. Locked to globals.css by
// tokens.test.ts.
export const space = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
} as const;

export type SpaceToken = keyof typeof space;
