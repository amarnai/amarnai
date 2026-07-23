import { describe, it, expect } from "vitest";
import {
  FOLDER_COLOR_KEYS,
  defaultFolderColorKey,
  resolveFolderColorKey,
  folderColorVars,
  folderInkVar,
} from "./folderColor.js";

describe("folderColor — deterministic default", () => {
  it("is stable across calls for the same id", () => {
    const a = defaultFolderColorKey("node_abc123");
    const b = defaultFolderColorKey("node_abc123");
    expect(a).toBe(b);
  });

  it("always returns a palette key", () => {
    for (const id of ["a", "node_1", "xY9_zzz", "同じ", "0000"]) {
      expect(FOLDER_COLOR_KEYS).toContain(defaultFolderColorKey(id));
    }
  });

  it("distributes different ids across more than one swatch", () => {
    const seen = new Set(
      Array.from({ length: 50 }, (_, i) => defaultFolderColorKey(`node_${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("folderColor — resolver precedence", () => {
  it("honors a valid user override over the default", () => {
    // Pick an override that differs from what the id would hash to, so we prove
    // the override wins rather than coincidentally matching.
    const id = "node_override_test";
    const def = defaultFolderColorKey(id);
    const override = FOLDER_COLOR_KEYS.find((k) => k !== def)!;
    expect(resolveFolderColorKey({ id, colorKey: override })).toBe(override);
  });

  it("falls back to the deterministic default when no override is set", () => {
    const id = "node_no_override";
    expect(resolveFolderColorKey({ id, colorKey: null })).toBe(
      defaultFolderColorKey(id),
    );
    expect(resolveFolderColorKey({ id })).toBe(defaultFolderColorKey(id));
  });

  it("falls back to the default for an unknown/legacy key instead of throwing", () => {
    const id = "node_legacy";
    expect(() =>
      resolveFolderColorKey({ id, colorKey: "chartreuse" }),
    ).not.toThrow();
    expect(resolveFolderColorKey({ id, colorKey: "chartreuse" })).toBe(
      defaultFolderColorKey(id),
    );
    expect(resolveFolderColorKey({ id, colorKey: "" })).toBe(
      defaultFolderColorKey(id),
    );
  });

  it("with a provider color absent (the only case today), still resolves to override then default", () => {
    // The provider-color branch is a commented stub — it never fires. This
    // pins the current two-tier behavior so re-enabling the stub is a visible
    // change: with no override, precedence yields the deterministic default.
    const id = "node_provider_stub";
    expect(resolveFolderColorKey({ id })).toBe(defaultFolderColorKey(id));
  });
});

describe("folderColor — CSS var helpers", () => {
  it("maps the resolved key to the token trio", () => {
    const id = "node_vars";
    const key = resolveFolderColorKey({ id });
    expect(folderColorVars({ id })).toEqual({
      "--folder-ink": `var(--folder-${key}-ink)`,
      "--folder-soft": `var(--folder-${key}-soft)`,
      "--folder-line": `var(--folder-${key}-line)`,
    });
    expect(folderInkVar({ id })).toBe(`var(--folder-${key}-ink)`);
  });

  it("reflects a valid override in the emitted vars", () => {
    const override = FOLDER_COLOR_KEYS[0];
    expect(folderInkVar({ id: "x", colorKey: override })).toBe(
      `var(--folder-${override}-ink)`,
    );
  });
});
