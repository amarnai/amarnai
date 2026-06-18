import { colors } from "./colors.js";

// CSS shadow strings (web) and structured RN shadow objects.
// Web uses `boxShadow: shadows.web.shadow1`.
// RN uses the `rn` variants with `shadowColor/Offset/Opacity/Radius` + `elevation`.

export const shadows = {
  web: {
    shadow1: "0 1px 1px oklch(20% 0.01 80 / 0.04), 0 2px 6px oklch(20% 0.01 80 / 0.045)",
    shadow2: "0 1px 2px oklch(20% 0.01 80 / 0.06), 0 8px 24px oklch(20% 0.01 80 / 0.08)",
    shadow3: "0 2px 4px oklch(20% 0.01 80 / 0.06), 0 18px 48px oklch(20% 0.01 80 / 0.12)",
  },
  rn: {
    shadow1: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 },  shadowOpacity: 0.05, shadowRadius: 4,  elevation: 2  },
    shadow2: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 8 },  shadowOpacity: 0.09, shadowRadius: 16, elevation: 6  },
    shadow3: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.12, shadowRadius: 32, elevation: 12 },
  },
} as const;
