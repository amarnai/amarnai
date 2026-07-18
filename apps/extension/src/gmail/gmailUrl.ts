// Builds a thread deep link that reuses an existing Gmail tab's account context
// by changing ONLY the URL hash. Gmail routes on the hash, so a fragment-only
// change navigates client-side with no full page reload — unlike the full
// account-routed URL from core's buildThreadUrl, whose `authuser` query forces a
// reload (and account redirect). Callers must only use this for a tab already
// pinned to the correct account, since it inherits whatever account the existing
// path (`/u/<index>/`) points at rather than routing by email.
export function buildGmailThreadHashUrl(existingUrl: string, providerThreadId: string): string {
  const hashIndex = existingUrl.indexOf("#");
  const base = hashIndex === -1 ? existingUrl : existingUrl.slice(0, hashIndex);
  return `${base}#all/${providerThreadId}`;
}
