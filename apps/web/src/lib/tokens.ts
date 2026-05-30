// Brand tokens for JS/TS components that need inline-computed color values
// (e.g. ReactFlow edge/marker colors that cannot use CSS variables).
// Raw hex values are defined once in globals.css :root; this file mirrors only
// the subset needed for JS expressions. Do not add new values here without a
// matching CSS variable in globals.css.

export const tokens = {
  primary: "#c2683f",      // --color-primary (--accent terracotta)
  accent: "#D4A017",       // --color-accent / --color-warning (--brand-gold)
  accentDim: "#b5890e",    // darker gold for selected-warning edge state
  edgeDefault: "#94a3b8",  // neutral slate for unselected, non-warning edges
} as const;
