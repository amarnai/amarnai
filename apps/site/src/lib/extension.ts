/**
 * Browser-extension store links for the marketing site.
 *
 * The Chrome listing is the shared constant from @aziru/ui, so the site, the
 * web app's install nudge and its "get the extension" banner cannot drift
 * apart. An env override exists for self-hosters shipping their own build; the
 * var names are shared with apps/web.
 */
import { CHROME_EXTENSION_STORE_URL } from "@aziru/ui";

export const CHROME_EXTENSION_URL: string =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || CHROME_EXTENSION_STORE_URL;

/**
 * Firefox add-on (AMO) listing. Not yet published, so this is sourced from the
 * environment and may be undefined. When absent, the install button renders
 * nothing for Firefox visitors rather than sending them to a Chrome-only
 * listing, and the sign-up link takes the primary styling instead.
 */
export const FIREFOX_EXTENSION_URL: string | undefined =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL_FIREFOX || undefined;
