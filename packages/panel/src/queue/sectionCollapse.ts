// Which queue sections the user has collapsed.
//
// Persisted rather than held in state because the panel is remounted constantly:
// every move between the thread list and a conversation tears the queue down and
// builds it again. A section that reopened itself on every navigation would be
// unusable, and one that re-collapsed after being opened would be worse.
//
// Storage is per host document, not per workspace. A member of two workspaces
// wants the same section open in both far more often than not, and a key per
// workspace would mostly serve to lose the setting when they switch.

export type QueueSectionKey = "assigned" | "needsReview" | "drafts";

const STORAGE_PREFIX = "aziru.panel.queue";

function storageKey(section: QueueSectionKey): string {
  return `${STORAGE_PREFIX}.${section}.collapsed`;
}

/**
 * Every access is guarded: an embedded frame can have storage denied outright
 * (third-party cookie blocking reaches localStorage too), and a panel that
 * throws on mount because a preference could not be read would be a preference
 * costing the whole feature.
 */
export function readSectionCollapsed(
  section: QueueSectionKey,
  defaultCollapsed: boolean,
): boolean {
  try {
    const stored = window.localStorage.getItem(storageKey(section));
    if (stored === null) return defaultCollapsed;
    return stored === "1";
  } catch {
    return defaultCollapsed;
  }
}

export function writeSectionCollapsed(section: QueueSectionKey, collapsed: boolean): void {
  try {
    window.localStorage.setItem(storageKey(section), collapsed ? "1" : "0");
  } catch {
    // The section still collapses for this mount; it just will not be
    // remembered. Nothing to tell the user about.
  }
}
