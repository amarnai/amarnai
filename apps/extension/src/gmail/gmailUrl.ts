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
