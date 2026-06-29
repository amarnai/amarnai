// Default catch-all leaf seeded into every workspace and appended to every
// taxonomy template. Single source of truth for its ref/name/description so the
// DB seeder (packages/db) and the templates (packages/core) never diverge. The
// name/description are stored in English (like the "Inbox" root) and localized
// at the render edge.

export const DEFAULT_CATCH_ALL_REF = "updates_other" as const;
export const DEFAULT_CATCH_ALL_NAME = "Updates / Other" as const;
export const DEFAULT_CATCH_ALL_DESCRIPTION =
  "Automated notifications, newsletters, and service updates that don't fit another folder." as const;

// Layout for the catch-all appended to a *template*, which already has children
// laid out around the root (y roughly -420..420). This sits well below them so
// it never overlaps a template folder.
export const DEFAULT_CATCH_ALL_POSITION = { x: 300, y: 600 } as const;

// Layout for the catch-all seeded into an *empty* workspace (root + catch-all
// only). Tucked slightly below the root rather than at its level, so a user
// hand-building a taxonomy keeps the root's row open for their first folder and
// doesn't feel boxed in by the catch-all.
export const DEFAULT_CATCH_ALL_SEED_POSITION = { x: 300, y: 200 } as const;
