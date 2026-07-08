import { buildGmailThreadUrl, buildGmailThreadHashUrl } from "./gmailUrl";
import { buildThreadUrl, type ThreadUrlInput } from "@amarnai/core/emails";
import { ext } from "../platform/ext";

// The Gmail tab we last navigated with the account-routing `authuser` URL, so we
// know it is pinned to the correct Google account. While a reused tab stays this
// one, we switch threads via a hash-only change (instant, no reload); any other
// tab gets a full `authuser` navigation first (one reload) to pin the account.
// Shared across call sites (thread-row icon + preview button) as a module
// singleton; it survives for the panel document's lifetime and resets to null on
// panel reopen, which just costs one more pinning navigation.
let pinnedTabId: number | null = null;

// Opens a thread in Gmail. Reuses an existing Gmail tab in the current window if
// one is open (so the panel stays docked next to it); otherwise opens a new tab.
// When a Gmail tab exists, prefer the active one so clicking from a focused Gmail
// tab navigates it in place rather than jumping to some other background Gmail
// tab; if none is focused, reuse the first Gmail tab and bring it to the front.
//
// Reuse avoids a full Gmail reload once the tab is pinned to the right account:
// the first open of a tab (or any tab we can't vouch for) uses the `authuser`
// URL, which reloads and redirects to the correct account, then pins it;
// subsequent opens of that same tab only change the URL hash, which Gmail routes
// client-side with no reload.
//
// Requires host_permissions for mail.google.com — no "tabs" permission needed
// (host permission grants URL visibility for that origin, so tab.url is readable).
export async function openInGmail(gmailAddress: string, providerThreadId: string): Promise<void> {
  const tabs = await ext.tabs.query({ url: "https://mail.google.com/*", currentWindow: true });
  const existing = tabs.find((t) => t.active) ?? tabs[0];

  if (existing?.id == null) {
    // No Gmail tab in this window: open a fresh one on the correct account and
    // pin it (a new tab loads fully regardless, so there is no extra reload).
    const created = await ext.tabs.create({ url: buildGmailThreadUrl(gmailAddress, providerThreadId) });
    pinnedTabId = created.id ?? null;
    return;
  }

  if (existing.id === pinnedTabId && existing.url) {
    // Already pinned to the right account: switch threads with a hash-only change
    // so Gmail navigates in place without reloading.
    await ext.tabs.update(existing.id, {
      url: buildGmailThreadHashUrl(existing.url, providerThreadId),
      active: true,
    });
    return;
  }

  // First open of this tab (or a different/unvouched tab): navigate by `authuser`
  // to guarantee the correct account. This reloads once, then pins the tab so
  // later opens are instant hash-only swaps.
  await ext.tabs.update(existing.id, {
    url: buildGmailThreadUrl(gmailAddress, providerThreadId),
    active: true,
  });
  pinnedTabId = existing.id;
}

// The OWA hosts an open Outlook tab can live on: office.com (work/school reading
// pane), office365.com (where Graph `webLink`s point before redirecting) and
// live.com (personal accounts). We match all three so a tab is found regardless
// of which host the mailbox resolved to; a single-host filter misses the common
// case where the webLink opened office365.com, which is why a new tab was always
// created. Kept in sync with the manifest/permissions host grants.
const OUTLOOK_TAB_URLS = [
  "https://outlook.office.com/*",
  "https://outlook.office365.com/*",
  "https://outlook.live.com/*",
];

// Opens a thread in Outlook on the web (OWA). Reuses an existing OWA tab in the
// current window so the panel stays docked; else opens a new tab. Unlike Gmail
// there is no zero-reload hash swap — OWA routes the message via its `webLink`,
// so every switch is one reload (accepted). The webLink already carries the
// account context, so no `authuser`-style pinning is needed and the Gmail
// pinnedTabId singleton is intentionally not used here.
//
// Requires host_permissions for the OWA hosts (see OUTLOOK_TAB_URLS).
export async function openInOutlook(webLink: string | null): Promise<void> {
  const url = buildThreadUrl({ provider: "OUTLOOK", providerThreadId: "", webLink });
  const tabs = await ext.tabs.query({
    url: OUTLOOK_TAB_URLS,
    currentWindow: true,
  });
  const existing = tabs.find((t) => t.active) ?? tabs[0];

  if (existing?.id == null) {
    await ext.tabs.create({ url });
    return;
  }
  await ext.tabs.update(existing.id, { url, active: true });
}

// Provider-aware dispatcher used by the panel call sites. Routes to the Gmail or
// Outlook tab-reuse path based on the thread's provider. `account` is the
// connected mailbox address (used only for Gmail account pinning).
export async function openThreadInMail(
  account: string,
  thread: ThreadUrlInput,
): Promise<void> {
  if (thread.provider === "OUTLOOK") {
    await openInOutlook(thread.webLink);
    return;
  }
  await openInGmail(account, thread.providerThreadId);
}

// Test-only: clears the pinned-tab singleton so cases run in isolation.
export function __resetPinnedGmailTab(): void {
  pinnedTabId = null;
}
