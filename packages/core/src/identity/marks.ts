// Presentational helpers for workspace + user avatar "marks": initials and a
// deterministic hue. Shared by the web sidebar and the mobile app header so both
// platforms render identical marks. Pure string math, no platform imports.

// Two-letter initials for a workspace name (first + last word, or first two
// letters of a single word). Falls back to "?" for an empty name.
export function workspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]!.at(0) ?? "") + (parts[parts.length - 1]!.at(0) ?? "")).toUpperCase();
  }
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

// Deterministic hue (0-359) derived from a workspace name, so each workspace gets
// a stable color without storing one.
export function workspaceHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

// Two-letter initials for a user: from their display name when present, else the
// first two letters of their email.
export function userInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    if (parts.length >= 2) return ((first.at(0) ?? "") + (last.at(0) ?? "")).toUpperCase();
    return first.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}
