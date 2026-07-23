// Per-folder color. Each taxonomy folder gets a stable, distinct swatch so a
// triage list is scannable. Color is a SECONDARY cue only — the folder name
// text always shows alongside it.
//
// Palette keys are chosen from the intersection of Gmail label colors and
// Outlook category colors, so a user's choice can later round-trip to a
// provider-native color (Gmail label / Outlook category) without a lossy remap.
// We store the palette KEY, never a raw hex value; the key maps to a
// theme-aware CSS token trio (see the `--folder-<key>-ink/-soft/-line` tokens
// in apps/web globals.css and apps/extension tokens.css).

export const FOLDER_COLOR_KEYS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type FolderColorKey = (typeof FOLDER_COLOR_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(FOLDER_COLOR_KEYS);

// The minimal shape the resolver needs. Both `FolderItem` and the API
// `TaxonomyNode` satisfy it, so any of them can be passed directly.
export type FolderColorInput = {
  id: string;
  // Explicit user override; null/absent = no override.
  colorKey?: string | null;
};

// FNV-1a over the id: deterministic, stable across sessions, and well
// distributed across the palette. Uses Math.imul for 32-bit overflow so the
// same id always lands on the same swatch in web, extension, and API.
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// The zero-storage default: every folder is colored even with no stored value.
export function defaultFolderColorKey(id: string): FolderColorKey {
  return FOLDER_COLOR_KEYS[hashId(id) % FOLDER_COLOR_KEYS.length]!;
}

// Resolve a folder to its palette key in priority order.
export function resolveFolderColorKey(folder: FolderColorInput): FolderColorKey {
  // 1. Provider-native color. Left as a commented stub: Amarnai will later
  //    create Gmail labels / Outlook categories that carry their own colors,
  //    map those back to a palette key, and prefer them here. No provider
  //    color sync exists today, so this branch never fires.
  //
  // if (folder.providerColorKey && KEY_SET.has(folder.providerColorKey)) {
  //   return folder.providerColorKey as FolderColorKey;
  // }

  // 2. Explicit user override — honored only when it names a known swatch. An
  //    unknown or legacy key falls through to the deterministic default rather
  //    than throwing, so removing a palette entry can never break rendering.
  if (folder.colorKey && KEY_SET.has(folder.colorKey)) {
    return folder.colorKey as FolderColorKey;
  }

  // 3. Deterministic default: hash the folder id into the palette.
  return defaultFolderColorKey(folder.id);
}

// The CSS custom-property trio the routing chip consumes. Set inline per chip
// (`style={folderColorVars(folder)}`) instead of emitting one class per color;
// `.em-route-chip` reads these with an `--accent-*` fallback.
export type FolderColorVars = {
  "--folder-ink": string;
  "--folder-soft": string;
  "--folder-line": string;
};

export function folderColorVars(folder: FolderColorInput): FolderColorVars {
  const key = resolveFolderColorKey(folder);
  return {
    "--folder-ink": `var(--folder-${key}-ink)`,
    "--folder-soft": `var(--folder-${key}-soft)`,
    "--folder-line": `var(--folder-${key}-line)`,
  };
}

// The single ink color, for folder icons and dots that only need a foreground
// tint (they set `color:` and rely on `stroke="currentColor"`).
export function folderInkVar(folder: FolderColorInput): string {
  return `var(--folder-${resolveFolderColorKey(folder)}-ink)`;
}
