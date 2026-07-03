import { buildGmailThreadUrl } from "./gmailUrl";
import { ext } from "../platform/ext";

// Opens a thread in Gmail. Reuses an existing Gmail tab in the current window if
// one is open (so the panel stays docked next to it); otherwise opens a new tab.
// Requires host_permissions for mail.google.com — no "tabs" permission needed
// (host permission grants URL visibility for that origin).
export async function openInGmail(gmailAddress: string, providerThreadId: string): Promise<void> {
  const url = buildGmailThreadUrl(gmailAddress, providerThreadId);
  const tabs = await ext.tabs.query({ url: "https://mail.google.com/*", currentWindow: true });
  const existing = tabs[0];
  if (existing?.id != null) {
    await ext.tabs.update(existing.id, { url, active: true });
  } else {
    await ext.tabs.create({ url });
  }
}
