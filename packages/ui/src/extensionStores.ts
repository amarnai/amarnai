/**
 * Canonical browser-extension store listings.
 *
 * The site's install button, the web app's install nudge and its "get the
 * extension" banner all need the same Chrome Web Store URL. Kept here so a
 * stale copy in any one of them cannot become a dead link. Environment
 * overrides still win where an app reads one (a self-hoster may publish their
 * own build); this constant is the fallback that guarantees a click target.
 *
 * There is no Firefox constant: the AMO listing is unpublished, so that URL
 * stays environment-only and its absence is a supported state.
 */
export const CHROME_EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/amarnai-ai-triage-for-gma/ncplnmcaaldppmamnjegnpaonkfbgcem";
