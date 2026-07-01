import { colors } from "@amarnai/tokens";

export const taxonomyTokens = {
  primary:    colors.accent,
  accent:     "#D4A017",
  accentDim:  "#b5890e",
  edgeDefault: "#94a3b8",
} as const;

// Edge stroke/marker colors are resolved from CSS vars (--rf-edge-*) so they
// follow the active theme. ReactFlow draws markers/strokes with concrete color
// strings (no var() at draw time), so we read the resolved values at render.
// Falls back to the light values during SSR, where `document` is unavailable.
// Shared by both the interactive editor (apps/web) and this read-only canvas so
// the two stay in lockstep.
export const EDGE_COLOR_FALLBACK = {
  default: "#94a3b8",
  selected: "#c2683f",
  warn: "#d4a017",
  warnSelected: "#b5890e",
} as const;

export type TaxonomyEdgeColors = Record<keyof typeof EDGE_COLOR_FALLBACK, string>;

export function readEdgeColors(): TaxonomyEdgeColors {
  if (typeof document === "undefined") return { ...EDGE_COLOR_FALLBACK };
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fb: string) =>
    cs.getPropertyValue(name).trim() || fb;
  return {
    default: read("--rf-edge-default", EDGE_COLOR_FALLBACK.default),
    selected: read("--rf-edge-selected", EDGE_COLOR_FALLBACK.selected),
    warn: read("--rf-edge-warn", EDGE_COLOR_FALLBACK.warn),
    warnSelected: read("--rf-edge-warn-selected", EDGE_COLOR_FALLBACK.warnSelected),
  };
}
