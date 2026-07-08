import { ext } from "./ext";
import { API_BASE_URL } from "../config";
import { MAIL_HOSTS } from "./mailHosts";

// Same origins as the manifest's host_permissions (both derived from
// VITE_API_URL plus the shared MAIL_HOSTS list), so the runtime request can never
// drift from what the manifest declares. Firefox treats MV3 host_permissions as
// user-grantable and does not auto-grant them on temporary loads, so without these
// the panel's API fetch/SSE are CORS-blocked and tabs.query({url}) matches
// nothing. Chrome grants them at install, so request() resolves true silently.
const ORIGINS = [`${new URL(API_BASE_URL).origin}/*`, ...MAIL_HOSTS];

// Ensures the extension holds its host permissions, prompting on Firefox if not.
//
// MUST be the first await inside a user-input handler (a button click): awaiting
// anything else first drops Firefox's user-gesture context and request() rejects.
// On rejection (no gesture, or a platform quirk) we fall back to a passive
// contains() check so an already-granted install still proceeds.
export async function ensureHostPermissions(): Promise<boolean> {
  try {
    return await ext.permissions.request({ origins: ORIGINS });
  } catch {
    return ext.permissions.contains({ origins: ORIGINS });
  }
}

// Passive check with no prompt — for gating UI outside a user gesture (e.g. a
// signed-in session restored from stored tokens where the grant may be missing).
export async function hasHostPermissions(): Promise<boolean> {
  return ext.permissions.contains({ origins: ORIGINS });
}
