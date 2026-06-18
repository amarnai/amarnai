// Hex approximations of globals.css oklch values.
// The web layer uses the CSS variables for accurate oklch rendering;
// these hex values exist for JS expressions and React Native StyleSheets.
export const colors = {
  // ── Surfaces ──
  bg:       "#faf9f6",  // oklch(98.4% 0.006 80)
  bgSoft:   "#f7f5f1",  // oklch(97.0% 0.008 80)
  bgSunk:   "#f3f0ea",  // oklch(95.5% 0.009 80)
  surface:  "#ffffff",
  surface2: "#fdfcfa",  // oklch(99.0% 0.004 80)

  // ── Ink scale ──
  ink:  "#292621",  // oklch(22% 0.012 80)
  ink2: "#4d4843",  // oklch(38% 0.010 80)
  ink3: "#706c66",  // oklch(54% 0.009 80)
  ink4: "#9c9892",  // oklch(70% 0.006 80)
  ink5: "#bbb8b3",  // oklch(82% 0.005 80)

  // ── Lines / borders ──
  line:  "#ece9e4",  // oklch(93% 0.005 80)
  line2: "#dfdbd6",  // oklch(88% 0.006 80)
  line3: "#cac6bf",  // oklch(80% 0.008 80)

  // ── Accent — terracotta ──
  accent:      "#c2683f",  // oklch(56% 0.14 40)
  accentHover: "#ad5b32",  // oklch(51% 0.15 40)
  accentInk:   "#7b3a1d",  // oklch(34% 0.10 40)
  accentSoft:  "#faeee7",  // oklch(96% 0.025 40)
  accentLine:  "#e8c4b3",  // oklch(87% 0.05 40)

  // ── Teal — AI generation actions ──
  teal:     "#2e9b89",  // oklch(57% 0.13 190)
  tealSoft: "#eaf5f3",  // oklch(95.5% 0.025 190)
  tealLine: "#9fd5ce",  // oklch(86% 0.055 190)
  tealInk:  "#1b6259",  // oklch(34% 0.09 190)

  // ── State: ok / warn / danger ──
  ok:          "#4da85d",  // oklch(58% 0.12 145)
  okInk:       "#2e6636",  // oklch(40% 0.10 145)
  okSoft:      "#edf7ee",  // oklch(96% 0.03 145)
  okLine:      "#9fd4aa",  // oklch(86% 0.06 145)
  okInkDark:   "#285b30",  // oklch(35% 0.10 145)

  warn:        "#dba53b",  // oklch(72% 0.12 65)
  warnInk:     "#78571c",  // oklch(45% 0.09 55)
  warnSoft:    "#fef4e4",  // oklch(96% 0.028 75)
  warnLine:    "#e5cb79",  // oklch(86% 0.06 65)

  danger:      "#c24426",  // oklch(50% 0.16 25)
  dangerSoft:  "#fdf0ee",  // oklch(96.5% 0.02 25)
  dangerLine:  "#e8a897",  // oklch(86% 0.06 25)
  dangerInk:   "#6d2015",  // oklch(35% 0.14 25)
} as const;

export type ColorToken = keyof typeof colors;
export type ColorValue = (typeof colors)[ColorToken];
