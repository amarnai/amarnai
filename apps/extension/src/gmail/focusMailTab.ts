import { ext } from "../platform/ext";
import { GMAIL_MAIL_HOST, OUTLOOK_MAIL_HOSTS } from "../platform/mailHosts";
import type { MailProvider } from "@amarnai/api-client";

/**
 * Brings the user's already-open mailbox tab to the front, without navigating
 * it. Used to end flows that took the user out to a tab of their own (checkout,
 * consent) and should return them to where they were working, rather than
 * leaving them on whatever page the detour finished on.
 *
 * Deliberately does NOT open a mailbox when none is open: this runs after the
 * user has been sent somewhere else, and conjuring a tab they never asked for
 * would be a worse ending than simply leaving them be. Prefers the active mail
 * tab, so a user with several lands on the one they were last using.
 *
 * Returns whether a tab was focused, so callers can fall back.
 *
 * Needs only host_permissions for the mail hosts; reading `tab.url` for an
 * origin we hold a grant for does not require the "tabs" permission.
 */
export async function focusMailTab(provider: MailProvider): Promise<boolean> {
  const target = await findMailTab(provider);
  if (target?.id == null) return false;

  try {
    await ext.tabs.update(target.id, { active: true });
    return true;
  } catch {
    // Focusing is a courtesy at the end of a flow that has already succeeded;
    // never let it surface as a failure.
    return false;
  }
}

/**
 * The mailbox tab to reuse in this window, or null when none is open. Prefers
 * the active one, so a user with several mailboxes gets the one they were last
 * using rather than an arbitrary background tab.
 *
 * Says nothing about which account the tab is signed into: Gmail's `/u/<index>/`
 * is per-profile sign-in order, not an identity, so callers that care must
 * navigate the tab by account rather than trust what it is already showing.
 *
 * Returns null rather than throwing when the query is refused (missing host
 * permission), so callers fall back to opening a tab of their own.
 */
export async function findMailTab(provider: MailProvider): Promise<chrome.tabs.Tab | null> {
  const urls = provider === "OUTLOOK" ? OUTLOOK_MAIL_HOSTS : GMAIL_MAIL_HOST;
  try {
    const tabs = await ext.tabs.query({ url: urls, currentWindow: true });
    return tabs.find((t) => t.active) ?? tabs[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Closes a tab this extension opened. Reliable in a way `window.close()` is not:
 * the browser restricts a page closing itself once it has navigated across
 * origins, which every checkout tab does.
 */
export async function closeTab(tabId: number): Promise<void> {
  try {
    await ext.tabs.remove(tabId);
  } catch {
    // Already closed by the user, or gone with its window.
  }
}
