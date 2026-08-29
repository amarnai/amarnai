import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { colors, radii, shadows, space, fontSize } from "./index.js";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const dir = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(dir, "../../../apps/web/src/app/globals.css");

describe("@amarnai/tokens", () => {
  describe("colors", () => {
    it("every color value is a 6-digit hex string", () => {
      for (const [key, value] of Object.entries(colors)) {
        expect(value, `colors.${key}`).toMatch(HEX_RE);
      }
    });

    it("accent is the confirmed terracotta hex", () => {
      expect(colors.accent).toBe("#c2683f");
    });
  });

  describe("radii", () => {
    it("all radii are positive integers", () => {
      for (const [key, value] of Object.entries(radii)) {
        expect(value, `radii.${key}`).toBeGreaterThan(0);
        expect(Number.isInteger(value), `radii.${key} is integer`).toBe(true);
      }
    });

    it("sm < md < lg < xl", () => {
      expect(radii.sm).toBeLessThan(radii.md);
      expect(radii.md).toBeLessThan(radii.lg);
      expect(radii.lg).toBeLessThan(radii.xl);
    });
  });

  describe("space", () => {
    it("all spacing values are positive integers", () => {
      for (const [key, value] of Object.entries(space)) {
        expect(value, `space.${key}`).toBeGreaterThan(0);
        expect(Number.isInteger(value), `space.${key} is integer`).toBe(true);
      }
    });

    it("scale is strictly increasing xxs -> xxl", () => {
      const ordered = [space.xxs, space.xs, space.sm, space.md, space.lg, space.xl, space.xxl];
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i]).toBeGreaterThan(ordered[i - 1]!);
      }
    });
  });

  describe("fontSize", () => {
    it("all font sizes are positive integers", () => {
      for (const [key, value] of Object.entries(fontSize)) {
        expect(value, `fontSize.${key}`).toBeGreaterThan(0);
        expect(Number.isInteger(value), `fontSize.${key} is integer`).toBe(true);
      }
    });

    it("scale is strictly increasing xs -> display", () => {
      const ordered = [
        fontSize.xs,
        fontSize.sm,
        fontSize.base,
        fontSize.md,
        fontSize.lg,
        fontSize.xl,
        fontSize.xxl,
        fontSize.display,
      ];
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i]).toBeGreaterThan(ordered[i - 1]!);
      }
    });
  });

  describe("shadows", () => {
    it("web shadows are non-empty strings", () => {
      expect(shadows.web.shadow1.length).toBeGreaterThan(0);
      expect(shadows.web.shadow2.length).toBeGreaterThan(0);
      expect(shadows.web.shadow3.length).toBeGreaterThan(0);
    });

    it("rn shadows have required keys", () => {
      for (const [key, s] of Object.entries(shadows.rn)) {
        expect(s, `shadows.rn.${key}`).toMatchObject({
          shadowColor: expect.any(String),
          shadowOffset: { width: expect.any(Number), height: expect.any(Number) },
          shadowOpacity: expect.any(Number),
          shadowRadius: expect.any(Number),
          elevation: expect.any(Number),
        });
      }
    });
  });

  describe("globals.css consistency", () => {
    it("globals.css defines the expected CSS token variables", () => {
      const css = readFileSync(cssPath, "utf8");

      const requiredVars = [
        "--accent",
        "--bg",
        "--bg-soft",
        "--ink",
        "--line",
        "--r-sm",
        "--r-md",
        "--r-lg",
        "--r-xl",
        "--shadow-1",
        "--shadow-2",
        "--shadow-3",
        "--ok",
        "--warn",
        "--danger",
        "--teal",
        "--space-xxs",
        "--space-xxl",
        "--fs-xs",
        "--fs-xxl",
      ];

      for (const v of requiredVars) {
        expect(css, `globals.css should define ${v}`).toContain(v + ":");
      }
    });

    it("globals.css --space-* values match the space scale", () => {
      const css = readFileSync(cssPath, "utf8");
      for (const [key, value] of Object.entries(space)) {
        const match = css.match(new RegExp(`--space-${key}\\s*:\\s*(\\d+)px`));
        expect(match, `--space-${key} present in globals.css`).not.toBeNull();
        expect(Number(match?.[1]), `--space-${key} matches space.${key}`).toBe(value);
      }
    });

    it("globals.css --fs-* values match the fontSize scale", () => {
      const css = readFileSync(cssPath, "utf8");
      for (const [key, value] of Object.entries(fontSize)) {
        const match = css.match(new RegExp(`--fs-${key}\\s*:\\s*(\\d+)px`));
        expect(match, `--fs-${key} present in globals.css`).not.toBeNull();
        expect(Number(match?.[1]), `--fs-${key} matches fontSize.${key}`).toBe(value);
      }
    });

    it("globals.css --r-sm value matches radii.sm", () => {
      const css = readFileSync(cssPath, "utf8");
      const match = css.match(/--r-sm\s*:\s*(\d+)px/);
      expect(match, "--r-sm present in globals.css").not.toBeNull();
      expect(Number(match?.[1])).toBe(radii.sm);
    });

    it("globals.css --r-xl value matches radii.xl", () => {
      const css = readFileSync(cssPath, "utf8");
      const match = css.match(/--r-xl\s*:\s*(\d+)px/);
      expect(match, "--r-xl present in globals.css").not.toBeNull();
      expect(Number(match?.[1])).toBe(radii.xl);
    });
  });
});
