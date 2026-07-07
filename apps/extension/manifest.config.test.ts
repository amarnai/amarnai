import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest.config";

const API = "https://api.amarnai.com";

describe("buildManifest — chrome", () => {
  it("emits the Chrome MV3 shape with side panel + service worker", () => {
    const m = buildManifest({ apiUrl: API, browser: "chrome" }) as Record<string, unknown>;
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
    const m = buildManifest({ apiUrl: API }) as Record<string, unknown>;
    expect(m["side_panel"]).toBeDefined();
  });

  it("injects key only when provided", () => {
    expect((buildManifest({ apiUrl: API }) as Record<string, unknown>)["key"]).toBeUndefined();
    expect(
      (buildManifest({ apiUrl: API, key: "PUBKEY" }) as Record<string, unknown>)["key"],
    ).toBe("PUBKEY");
  });
});

describe("buildManifest — firefox", () => {
  const m = buildManifest({ apiUrl: API, browser: "firefox", key: "PUBKEY" }) as Record<
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
        id: "amarnai@amarnai.com",
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
    expect(m["permissions"]).toEqual(["storage", "identity", "clipboardWrite"]);
  });
});

describe("buildManifest — host permissions", () => {
  it("derives host_permissions from the API origin on both targets", () => {
    for (const browser of ["chrome", "firefox"] as const) {
      const m = buildManifest({ apiUrl: "https://api.example.test/base", browser }) as Record<
        string,
        unknown
      >;
      expect(m["host_permissions"]).toEqual([
        "https://api.example.test/*",
        "https://mail.google.com/*",
        "https://outlook.office.com/*",
      ]);
    }
  });
});
