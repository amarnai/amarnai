// Build-time configuration. Vite inlines import.meta.env.VITE_* at build time.
// VITE_API_URL must match one of the manifest host_permissions origins, or the
// panel's fetches (including the SSE stream) will be blocked by CORS.

export const API_BASE_URL: string = (
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:3001"
).replace(/\/+$/, "");

// The Google OAuth Web client id (same client the API redeems codes against).
// Required only for the Google sign-in button.
export const GOOGLE_WEB_CLIENT_ID: string =
  (import.meta.env["VITE_GOOGLE_WEB_CLIENT_ID"] as string | undefined) ?? "";

// The Microsoft (Entra) app registration client id — the same confidential Web
// client the API redeems Outlook codes against. Empty when Outlook is not
// configured, which hides the Outlook reconnect option.
export const MS_CLIENT_ID: string =
  (import.meta.env["VITE_MS_CLIENT_ID"] as string | undefined) ?? "";

// InboxSDK application id, used by the Gmail content script to render the
// "Aziru Reply" button in Gmail's own compose. Not a secret — it ships inside
// the extension bundle and identifies the app to the SDK. Self-hosters should
// register their own at inboxsdk.com rather than reuse Aziru's. Empty means
// the button never loads; everything else in the content script still works.
export const INBOXSDK_APP_ID: string =
  (import.meta.env["VITE_INBOXSDK_APP_ID"] as string | undefined) ?? "";

// Where the marketing/web app lives, for links out (sign-up, connect Gmail).
export const WEB_APP_URL: string = (
  (import.meta.env["VITE_WEB_APP_URL"] as string | undefined) ?? "http://localhost:3000"
).replace(/\/+$/, "");
