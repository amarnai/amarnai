// Type scale shared by web (via --fs-* CSS vars in globals.css) and React Native
// (StyleSheet). fontSize values are in px; fontWeight values are weight strings
// valid in both RN TextStyle and CSS. Locked to globals.css by tokens.test.ts.
export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 16,
  xxl: 18,
  display: 32, // brand / page headings (e.g. sign-in)
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export type FontSizeToken = keyof typeof fontSize;
export type FontWeightToken = keyof typeof fontWeight;
