/**
 * Browser-extension store links. Kept in one place so listing URLs are not
 * hardcoded at each usage site.
 */

export const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/amarnai-ai-triage-for-gma/ncplnmcaaldppmamnjegnpaonkfbgcem";

/**
 * Firefox add-on (AMO) listing. Not yet published, so this is sourced from the
 * environment and may be undefined. When absent, the UI shows a "coming soon"
 * state instead of a live link.
 */
export const FIREFOX_EXTENSION_URL: string | undefined =
  process.env.NEXT_PUBLIC_FIREFOX_EXTENSION_URL || undefined;
