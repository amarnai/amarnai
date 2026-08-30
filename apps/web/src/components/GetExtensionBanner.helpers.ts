// Pure, DOM-free helpers for GetExtensionBanner — kept separate so the
// detection and URL-pick logic is unit-testable without a browser environment.
// Mirrors AppDownloadBanner.helpers.ts in packages/ui.

export const DISMISS_KEY = "amarnai.extensionBanner.dismissed";

// Mobile browsers cannot install a desktop extension, so nudging there is a
// dead end. Matched on the UA's mobile markers rather than a viewport width:
// this is about capability, not layout.
export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
}

export function isFirefox(ua: string): boolean {
  return /Firefox/i.test(ua);
}

// Chromium browsers that identify as Chrome cover the Chrome Web Store; Safari
// is neither, and has no listing, so it gets nothing.
export function isChromium(ua: string): boolean {
  return /Chrome|Chromium|CriOS|Edg\//i.test(ua);
}

/**
 * True only on a desktop browser that can install one of our listings.
 * The banner is additionally gated server-side on the user having no
 * ExtensionInstall row, so this only has to answer "could they install it".
 */
export function isDesktopExtensionBrowser(ua: string): boolean {
  if (isMobileUserAgent(ua)) return false;
  return isFirefox(ua) || isChromium(ua);
}

/**
 * Which listing to send this browser to.
 *
 * Firefox gets the AMO listing when one is configured; with none published it
 * falls back to Chrome rather than showing nothing, matching the notification
 * nudge's behaviour. Returns null when neither listing exists (a self-host with
 * no published build).
 */
export function pickStoreUrl(
  ua: string,
  chromeUrl: string | null,
  firefoxUrl: string | null,
): string | null {
  return isFirefox(ua) ? (firefoxUrl ?? chromeUrl) : (chromeUrl ?? firefoxUrl);
}
