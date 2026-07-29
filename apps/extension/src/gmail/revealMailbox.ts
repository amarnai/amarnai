import { buildMailboxUrl } from "@amarnai/core/emails";
import type { MailProvider } from "@amarnai/api-client";
import { ext } from "../platform/ext";
import { takeWelcomeTabId } from "../platform/welcomeTab";
import { findMailTab } from "./focusMailTab";

// Set once the user has been taken to their mailbox, and never cleared: this is
// an onboarding step, not a preference. storage.local so it survives the panel
// being closed and the browser being restarted — a returning user signing in
// from a work tab must be left where they are.
const KEY = "amarnai.mailboxRevealed";

// Guards the same panel document racing itself: two loads of the triage seed can
// resolve before either has written the storage flag. Set before the first await
// so there is no window in between.
let started = false;

/**
 * Takes the user to the mailbox their panel is meant to sit beside, once per
 * install, right after they first connect an inbox.
 *
 * The panel is a companion to Gmail/Outlook and the content scripts only run
 * there, so a user who signed in from an unrelated tab has no route to the thing
 * they just authorized. This is the one moment where moving them is fair: it is
 * the immediate consequence of a button they pressed, not a tab appearing
 * minutes later once they have moved on.
 *
 * In order of preference:
 *   1. A mailbox tab is already open in this window -> reuse it, navigating it
 *      to the connected account rather than merely raising it. A browser signed
 *      into several Google accounts will have that tab on whichever one it was
 *      opened with, and nothing in its URL reveals which (see findMailTab), so
 *      focusing it would show the user someone else's inbox at the exact moment
 *      they are being shown "their" mailbox. Costs one reload, which is worth
 *      landing on the right account.
 *   2. The welcome tab is still open -> navigate it, since it is a page this
 *      extension opened and is finished with. No new tab, no dead tab left over.
 *   3. Otherwise open one.
 *
 * Gmail redirects `authuser=<email>` to the right mailbox. OWA cannot be made to
 * switch an existing wrong-account session by URL (see buildMailboxUrl), so for
 * Outlook this guarantees the right mailbox only when the account is signed in
 * or the session is fresh.
 *
 * Never throws: this is a courtesy at the end of a sign-in that already
 * succeeded, and must not read as a failure of the sign-in.
 */
export async function revealMailboxOnce(
  provider: MailProvider,
  accountEmail: string | null,
): Promise<void> {
  if (started) return;
  started = true;

  try {
    const out = await ext.storage.local.get(KEY);
    if (out[KEY]) return;
    // Claim it before acting, so a crash mid-navigation cannot hand the user a
    // second surprise tab on the next panel open.
    await ext.storage.local.set({ [KEY]: true });

    const url = buildMailboxUrl(provider, accountEmail);

    const existing = await findMailTab(provider);
    if (existing?.id != null) {
      await ext.tabs.update(existing.id, { url, active: true });
      return;
    }

    const welcomeTabId = await takeWelcomeTabId();
    if (welcomeTabId !== null) {
      await ext.tabs.update(welcomeTabId, { url, active: true });
      return;
    }
    await ext.tabs.create({ url });
  } catch {
    // Tab APIs refused, storage unavailable: the user simply stays put.
  }
}

// Test-only: clears the in-document guard so cases run in isolation.
export function __resetMailboxReveal(): void {
  started = false;
}
