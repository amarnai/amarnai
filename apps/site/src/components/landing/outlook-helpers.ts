/**
 * Small presentational helpers shared by the Outlook inbox mock and the Outlook
 * reading-pane view, so a given sender keeps the same colored avatar circle in
 * both places (as real Outlook does).
 */

/** First letter of a display name, uppercased, for the avatar circle. */
export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// Outlook assigns each contact a colored initials circle. We mirror that with a
// small fixed palette (see .ld-ol-av--N in landing.css) picked deterministically
// from the name, so the same person is the same color across the list and thread.
const OL_AVATAR_COUNT = 6;

export function outlookAvatarClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `ld-ol-av--${hash % OL_AVATAR_COUNT}`;
}
