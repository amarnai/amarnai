import { describe, it, expect } from "vitest";
import {
  DEFAULT_PACKAGE,
  DEFAULT_SCHEME,
  buildIntentUrl,
  isAndroid,
  isInAppWebView,
  shouldShowBanner,
} from "./AppDownloadBanner.helpers.js";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36";
const INSTAGRAM_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.0";

describe("AppDownloadBanner helpers", () => {
  describe("isAndroid", () => {
    it("matches Android browsers", () => {
      expect(isAndroid(ANDROID_CHROME)).toBe(true);
    });
    it("rejects iOS and desktop", () => {
      expect(isAndroid(IPHONE_SAFARI)).toBe(false);
      expect(isAndroid(DESKTOP_CHROME)).toBe(false);
    });
  });

  describe("isInAppWebView", () => {
    it("flags the Android `wv` webview marker", () => {
      expect(isInAppWebView(ANDROID_WEBVIEW)).toBe(true);
    });
    it("flags known in-app browsers (Instagram)", () => {
      expect(isInAppWebView(INSTAGRAM_ANDROID)).toBe(true);
    });
    it("does not flag a real Android Chrome", () => {
      expect(isInAppWebView(ANDROID_CHROME)).toBe(false);
    });
  });

  describe("shouldShowBanner", () => {
    it("shows on real Android Chrome", () => {
      expect(shouldShowBanner(ANDROID_CHROME)).toBe(true);
    });
    it("hides on iOS, desktop, and Android webviews", () => {
      expect(shouldShowBanner(IPHONE_SAFARI)).toBe(false);
      expect(shouldShowBanner(DESKTOP_CHROME)).toBe(false);
      expect(shouldShowBanner(ANDROID_WEBVIEW)).toBe(false);
      expect(shouldShowBanner(INSTAGRAM_ANDROID)).toBe(false);
    });
  });

  describe("buildIntentUrl", () => {
    const playStore =
      "https://play.google.com/store/apps/details?id=com.amarnai.app";

    it("builds an Android intent URL with the package and scheme", () => {
      const url = buildIntentUrl(playStore, DEFAULT_PACKAGE, DEFAULT_SCHEME);
      expect(url).toContain(`scheme=${DEFAULT_SCHEME}`);
      expect(url).toContain(`package=${DEFAULT_PACKAGE}`);
      expect(url.startsWith("intent://")).toBe(true);
      expect(url.endsWith(";end")).toBe(true);
    });

    it("url-encodes the Play Store fallback so query params survive", () => {
      const url = buildIntentUrl(playStore, DEFAULT_PACKAGE, DEFAULT_SCHEME);
      expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent(playStore)}`);
      // The raw "?id=" must not leak unencoded into the intent string.
      expect(url).not.toContain("details?id=");
    });
  });
});
