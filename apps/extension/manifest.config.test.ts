import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest.config";

const API = "https://api.aziru.email";
const WEB = "https://app.aziru.email";

describe("buildManifest — chrome", () => {
  it("emits the Chrome MV3 shape with side panel + service worker", () => {
    const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser: "chrome" }) as Record<string, unknown>;
    expect(m["manifest_version"]).toBe(3);
    expect(m["side_panel"]).toEqual({ default_path: "index.html" });
    expect(m["minimum_chrome_version"]).toBe("116");
    expect(m["background"]).toEqual({ service_worker: "service-worker.js", type: "module" });
    expect(m["permissions"]).toContain("sidePanel");
    // No Firefox-only keys.
    expect(m["sidebar_action"]).toBeUndefined();
    expect(m["browser_specific_settings"]).toBeUndefined();
  });

  it("defaults to chrome when no browser is given", () => {
    const m = buildManifest({ apiUrl: API, webAppUrl: WEB }) as Record<string, unknown>;
    expect(m["side_panel"]).toBeDefined();
  });

  it("injects key only when provided", () => {
    expect((buildManifest({ apiUrl: API, webAppUrl: WEB }) as Record<string, unknown>)["key"]).toBeUndefined();
    expect(
      (buildManifest({ apiUrl: API, webAppUrl: WEB, key: "PUBKEY" }) as Record<string, unknown>)["key"],
    ).toBe("PUBKEY");
  });
});

describe("buildManifest — firefox", () => {
  const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser: "firefox", key: "PUBKEY" }) as Record<
    string,
    unknown
  >;

  it("emits the Firefox shape with sidebar + event page", () => {
    expect(m["manifest_version"]).toBe(3);
    expect(m["sidebar_action"]).toMatchObject({ default_panel: "index.html" });
    expect(m["background"]).toEqual({ scripts: ["service-worker.js"], type: "module" });
  });

  it("declares a stable gecko id, min version, and data-collection", () => {
    expect(m["browser_specific_settings"]).toEqual({
      gecko: {
        id: "aziru@aziru.com",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["authenticationInfo"] },
      },
    });
  });

  it("omits all Chrome-only keys, including key even when passed", () => {
    expect(m["key"]).toBeUndefined();
    expect(m["minimum_chrome_version"]).toBeUndefined();
    expect(m["side_panel"]).toBeUndefined();
    expect(m["permissions"]).not.toContain("sidePanel");
    expect(m["permissions"]).toEqual(["storage", "identity", "clipboardWrite", "scripting"]);
  });
});

describe("buildManifest — host permissions", () => {
  it("derives host_permissions from the API and web-app origins on both targets", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({
        apiUrl: "https://api.example.test/base",
        webAppUrl: "https://app.example.test/",
        browser,
      }) as Record<string, unknown>;
      expect(m["host_permissions"]).toEqual([
        "https://api.example.test/*",
        "https://app.example.test/*",
        "https://mail.google.com/*",
        "https://outlook.office.com/*",
        "https://outlook.office365.com/*",
        "https://outlook.live.com/*",
      ]);
    }
  });

  it("does not duplicate the grant when a self-host serves both from one origin", () => {
    const m = buildManifest({
      apiUrl: "https://aziru.example.test/api",
      webAppUrl: "https://aziru.example.test",
    }) as Record<string, unknown>;

    expect(m["host_permissions"]).toEqual([
      "https://aziru.example.test/*",
      "https://mail.google.com/*",
      "https://outlook.office.com/*",
      "https://outlook.office365.com/*",
      "https://outlook.live.com/*",
    ]);
  });
});

describe("buildManifest — native summary injection", () => {
  it("declares both content scripts on both targets", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser }) as Record<string, unknown>;
      expect(m["content_scripts"]).toEqual([
        {
          matches: ["https://mail.google.com/*"],
          js: ["content-gmail.js"],
          run_at: "document_idle",
        },
        {
          matches: [
            "https://outlook.office.com/*",
            "https://outlook.office365.com/*",
            "https://outlook.live.com/*",
          ],
          js: ["content-outlook.js"],
          run_at: "document_idle",
        },
      ]);
    }
  });

  it("omits content_scripts entirely under the build-time kill-switch", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser, nativeInjection: false }) as Record<
        string,
        unknown
      >;
      expect(m["content_scripts"]).toBeUndefined();
      expect("content_scripts" in m).toBe(false);
    }
  });

  // InboxSDK's page-world half and the button icon are loaded by Gmail's own
  // page, so they must be web-accessible — but only to Gmail. Any wider match
  // would let unrelated sites probe for the extension.
  it("exposes InboxSDK's files and the panel iframe to Gmail", () => {
    // `assets/*` is here because the built injected.html links its own hashed
    // JS and CSS from that directory; without it the iframe loads blank.
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser }) as Record<string, unknown>;
      expect(m["web_accessible_resources"]).toEqual([
        {
          resources: [
            "pageWorld.js",
            "reply-button-icon.svg",
            "panel-icon.svg",
            "injected.html",
            "assets/*",
          ],
          matches: ["https://mail.google.com/*"],
        },
        {
          resources: ["injected.html", "assets/*"],
          matches: [
            "https://outlook.office.com/*",
            "https://outlook.office365.com/*",
            "https://outlook.live.com/*",
          ],
        },
      ]);
    }
  });

  // OWA embeds the same panel document, so it needs the iframe and its assets —
  // and nothing else. The drawer's tab and the reply pill both draw their mark
  // as an inline SVG node, and InboxSDK is Gmail's alone, so exposing either the
  // images or pageWorld.js to Outlook would widen the surface for no call site.
  it("exposes only the panel iframe to OWA, never InboxSDK or the icons", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser }) as Record<string, unknown>;
      const entries = m["web_accessible_resources"] as { resources: string[]; matches: string[] }[];
      const owa = entries.find((e) => e.matches.some((h) => h.includes("outlook")));
      expect(owa).toBeDefined();
      expect(owa?.resources).toEqual(["injected.html", "assets/*"]);
      for (const forbidden of ["pageWorld.js", "reply-button-icon.svg", "panel-icon.svg"]) {
        expect(owa?.resources).not.toContain(forbidden);
      }
      // And no OWA host leaked into Gmail's entry, which does carry them.
      const gmail = entries.find((e) => e.resources.includes("pageWorld.js"));
      expect(gmail?.matches).toEqual(["https://mail.google.com/*"]);
    }
  });

  it("exposes nothing under the build-time kill-switch", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser, nativeInjection: false }) as Record<
        string,
        unknown
      >;
      expect("web_accessible_resources" in m).toBe(false);
    }
  });

  // Content scripts run on hosts the extension already asks for. The one
  // permission injection adds is `scripting` — InboxSDK's pageWorld.js must be
  // injected into Gmail's MAIN world by the background, and chrome.scripting is
  // the only MV3 way to do that. It rides the existing host grants and carries
  // no install-time warning; anything beyond it appearing here is a regression.
  it("adds exactly the scripting permission, and no host permissions", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const withInjection = buildManifest({ apiUrl: API, webAppUrl: WEB, browser }) as Record<string, unknown>;
      const without = buildManifest({ apiUrl: API, webAppUrl: WEB, browser, nativeInjection: false }) as Record<
        string,
        unknown
      >;
      expect(withInjection["host_permissions"]).toEqual(without["host_permissions"]);
      expect(withInjection["permissions"]).toEqual([
        ...(without["permissions"] as string[]),
        "scripting",
      ]);
    }
  });

  it("carries no scripting permission under the kill-switch (no call site exists)", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({ apiUrl: API, webAppUrl: WEB, browser, nativeInjection: false }) as Record<
        string,
        unknown
      >;
      expect(m["permissions"]).not.toContain("scripting");
    }
  });
});
