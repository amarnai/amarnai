// Pure, DOM-free helpers for AppDownloadBanner — kept separate so the
// detection/intent logic is unit-testable without a browser environment.

// Default Android identity for the Aziru app (apps/mobile/app.json).
export const DEFAULT_PACKAGE = "com.amarnai.app";
export const DEFAULT_SCHEME = "amarnai";
export const DISMISS_KEY = "amarnai.appBanner.dismissed";

// In-app browsers (webviews) should not be nudged to "download the app":
// the user is already inside another app and the Play Store deep link is
// unreliable there. Match the common webview user-agent markers.
export function isInAppWebView(ua: string): boolean {
  return /; wv\)|FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|GSA\//i.test(ua);
}

export function isAndroid(ua: string): boolean {
  return /Android/i.test(ua);
}

// True only on a real Android browser that is not an embedded webview.
export function shouldShowBanner(ua: string): boolean {
  return isAndroid(ua) && !isInAppWebView(ua);
}

// Open the app if installed, otherwise fall back to the Play Store listing.
export function buildIntentUrl(playStoreUrl: string, packageName: string, scheme: string): string {
  const fallback = encodeURIComponent(playStoreUrl);
  return `intent://#Intent;scheme=${scheme};package=${packageName};S.browser_fallback_url=${fallback};end`;
}
