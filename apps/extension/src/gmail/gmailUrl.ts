// Builds a deep link that opens a specific thread in Gmail's web UI.
//
// Gmail still resolves the raw Gmail API thread id (lowercase hex) in the URL
// hash, so no id translation is needed. Notes:
//  - Use `#all/` (not `#inbox/`): `#inbox/` 404s to an empty view for archived
//    threads, while `#all/` works regardless of label.
//  - Route by `authuser=<email>`, never `/u/<index>`: the numeric index depends
//    on Google sign-in order per profile and silently opens the wrong account.
//    Google redirects authuser=<email> to the right mailbox and preserves the
//    hash. (This is the approach Google's own Site Kit uses.)
export function buildGmailThreadUrl(gmailAddress: string, providerThreadId: string): string {
  const account = encodeURIComponent(gmailAddress);
  return `https://mail.google.com/mail/?authuser=${account}#all/${providerThreadId}`;
}

// Builds a thread deep link that reuses an existing Gmail tab's account context
// by changing ONLY the URL hash. Gmail routes on the hash, so a fragment-only
// change navigates client-side with no full page reload — unlike
// buildGmailThreadUrl, whose `authuser` query forces a reload (and account
// redirect). Callers must only use this for a tab already pinned to the correct
// account, since it inherits whatever account the existing path (`/u/<index>/`)
// points at rather than routing by email.
export function buildGmailThreadHashUrl(existingUrl: string, providerThreadId: string): string {
  const hashIndex = existingUrl.indexOf("#");
  const base = hashIndex === -1 ? existingUrl : existingUrl.slice(0, hashIndex);
  return `${base}#all/${providerThreadId}`;
}
