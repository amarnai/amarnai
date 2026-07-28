import { describe, it, expect } from "vitest";
import {
  isDesktopExtensionBrowser,
  isFirefox,
  isMobileUserAgent,
  pickStoreUrl,
} from "./GetExtensionBanner.helpers.js";

const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DESKTOP_FIREFOX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const DESKTOP_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const DESKTOP_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_FIREFOX =
  "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0";

const CHROME_URL = "https://chromewebstore.google.com/detail/amarnai/abc";
const FIREFOX_URL = "https://addons.mozilla.org/firefox/addon/amarnai/";

describe("GetExtensionBanner helpers", () => {
  describe("isMobileUserAgent", () => {
    it("flags phones and tablets", () => {
      expect(isMobileUserAgent(ANDROID_CHROME)).toBe(true);
      expect(isMobileUserAgent(IPHONE_SAFARI)).toBe(true);
    });
    it("leaves desktop alone", () => {
      expect(isMobileUserAgent(DESKTOP_CHROME)).toBe(false);
      expect(isMobileUserAgent(DESKTOP_FIREFOX)).toBe(false);
    });
  });

  describe("isFirefox", () => {
    it("matches Firefox on any platform", () => {
      expect(isFirefox(DESKTOP_FIREFOX)).toBe(true);
      expect(isFirefox(ANDROID_FIREFOX)).toBe(true);
    });
    it("does not match Chromium", () => {
      expect(isFirefox(DESKTOP_CHROME)).toBe(false);
    });
  });

  describe("isDesktopExtensionBrowser", () => {
    it("accepts desktop Chrome, Edge and Firefox", () => {
      expect(isDesktopExtensionBrowser(DESKTOP_CHROME)).toBe(true);
      expect(isDesktopExtensionBrowser(DESKTOP_EDGE)).toBe(true);
      expect(isDesktopExtensionBrowser(DESKTOP_FIREFOX)).toBe(true);
    });

    it("rejects every mobile browser, since none can install the extension", () => {
      expect(isDesktopExtensionBrowser(ANDROID_CHROME)).toBe(false);
      expect(isDesktopExtensionBrowser(IPHONE_SAFARI)).toBe(false);
      expect(isDesktopExtensionBrowser(ANDROID_FIREFOX)).toBe(false);
    });

    it("rejects desktop Safari, which has no listing", () => {
      expect(isDesktopExtensionBrowser(DESKTOP_SAFARI)).toBe(false);
    });
  });

  describe("pickStoreUrl", () => {
    it("sends Firefox to AMO and everyone else to the Chrome Web Store", () => {
      expect(pickStoreUrl(DESKTOP_FIREFOX, CHROME_URL, FIREFOX_URL)).toBe(FIREFOX_URL);
      expect(pickStoreUrl(DESKTOP_CHROME, CHROME_URL, FIREFOX_URL)).toBe(CHROME_URL);
    });

    it("falls back to the other listing when only one is configured", () => {
      expect(pickStoreUrl(DESKTOP_FIREFOX, CHROME_URL, null)).toBe(CHROME_URL);
      expect(pickStoreUrl(DESKTOP_CHROME, null, FIREFOX_URL)).toBe(FIREFOX_URL);
    });

    it("returns null when no listing exists at all", () => {
      expect(pickStoreUrl(DESKTOP_CHROME, null, null)).toBeNull();
    });
  });
});
