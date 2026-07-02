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

// Where the marketing/web app lives, for links out (sign-up, connect Gmail).
export const WEB_APP_URL: string = (
  (import.meta.env["VITE_WEB_APP_URL"] as string | undefined) ?? "http://localhost:3000"
).replace(/\/+$/, "");
