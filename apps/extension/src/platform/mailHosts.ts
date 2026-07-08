// Match patterns for the mail web apps the extension deep-links into and whose
// already-open tabs it reuses. Single source of truth shared by three call sites
// that must stay identical: the build-time manifest host_permissions
// (manifest.config.ts), the runtime host-permission request (permissions.ts
// ORIGINS), and the Outlook tab-reuse query (openInGmail.ts). Dependency-free so
// both the Node build script and the browser bundle can import it.

// Gmail web app.
export const GMAIL_MAIL_HOST = "https://mail.google.com/*";

// All three OWA hosts: office.com (work/school reading pane), office365.com (the
// host Graph `webLink`s point at, pre-redirect) and live.com (personal accounts).
// Reusing an open Outlook tab requires reading its URL, which needs a host grant
// for whichever host the mailbox resolved to; a single-host filter misses the
// common case where the webLink opened office365.com.
export const OUTLOOK_MAIL_HOSTS = [
  "https://outlook.office.com/*",
  "https://outlook.office365.com/*",
  "https://outlook.live.com/*",
];

// Every mail-web-app host the extension needs a grant for (Gmail + OWA), in the
// order the manifest/permissions lists expect.
export const MAIL_HOSTS = [GMAIL_MAIL_HOST, ...OUTLOOK_MAIL_HOSTS];
