import { ext } from "../../platform/ext.js";

// Gmail's companion rail starts collapsed and its icons are easy to never
// notice, so the first time the panel ever mounts — and only that one — it
// opens itself to show where it lives. Gmail itself remembers the rail's open
// state from then on. The OWA drawer makes the same introduction through its
// own remembered-state key (owaPanelExpanded, never written = first visit).

const AUTO_REVEAL_KEY = "gmailPanelAutoRevealed";

/**
 * True exactly once per install. The flag is written before the caller opens
 * anything, so a failure between the two costs the one reveal — never a panel
 * that pops open on every load. Unreadable storage claims nothing, for the
 * same reason.
 */
export async function claimFirstReveal(): Promise<boolean> {
  try {
    const stored = await ext.storage.local.get(AUTO_REVEAL_KEY);
    if (stored[AUTO_REVEAL_KEY] === true) return false;
    await ext.storage.local.set({ [AUTO_REVEAL_KEY]: true });
    return true;
  } catch {
    return false;
  }
}
