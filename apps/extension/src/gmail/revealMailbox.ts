import { buildMailboxUrl, type OutlookAccountType } from "@amarnai/core/emails";
import type { MailProvider } from "@amarnai/api-client";
import { ext } from "../platform/ext";
import { takeWelcomeTabId } from "../platform/welcomeTab";
import { findMailTab } from "./focusMailTab";

/**
 * Takes the user to the mailbox their panel is meant to sit beside, after they
 * sign in or connect an inbox.
 *
 * The panel is a companion to Gmail/Outlook and the content scripts only run
 * there, so a user who signed in from an unrelated tab has no route to the thing
 * they just authorized. This is the one moment where moving them is fair: it is
 * the immediate consequence of a button they pressed, not a tab appearing
 * minutes later once they have moved on.
 *
 * Every sign-in, deliberately, rather than only the first. A tab move that
 * happens once and then silently stops is the version users read as broken:
 * having seen it, they expect it, and cannot see the install-scoped flag that
 * would explain its absence. Callers are responsible for firing this only on a
 * real sign-in or connect gesture (see consumeJustConnected), never on a
 * session restore or a panel reopen, which the user did not ask for.
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
 * `accountType` picks the Outlook host: personal Microsoft accounts and
 * work/school accounts sit on different ones, and the work host rejects a
 * personal account outright rather than redirecting it. Pass what the connection
 * reports; null falls back to a guess from the address.
 *
 * Never throws: this is a courtesy at the end of a sign-in that already
 * succeeded, and must not read as a failure of the sign-in.
 */
export async function revealMailbox(
  provider: MailProvider,
  accountEmail: string | null,
  accountType: OutlookAccountType | null = null,
): Promise<void> {
  try {
    const url = buildMailboxUrl(provider, accountEmail, accountType);

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
    // Tab APIs refused: the user simply stays put.
  }
}
