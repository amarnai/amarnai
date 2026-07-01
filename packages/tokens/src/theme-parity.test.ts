import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Theme parity — guards the dark theme (and any future theme) against drift.
 *
 * The color custom properties in `:root` are the theme contract. A themeable
 * var is one whose `:root` value is a literal color (oklch/hex/rgb) rather than
 * a `var(--x)` reference (those auto-flip). Every themeable var must be
 * re-declared in every `html[data-theme="<id>"]` block, and all theme blocks
 * must agree — so a color added to one theme but not another fails CI.
 */

const dir = dirname(fileURLToPath(import.meta.url));

const GLOBALS: Record<string, string> = {
  web: resolve(dir, "../../../apps/web/src/app/globals.css"),
  site: resolve(dir, "../../../apps/site/src/app/globals.css"),
};

const COLOR_RE = /oklch\(|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/i;

/** Inner text of the first block whose opening selector matches `openRe`.
 * The theme blocks contain no nested braces, so the next `}` closes them. */
function blockBody(css: string, openRe: RegExp): string | null {
  const m = openRe.exec(css);
  if (!m) return null;
  const start = css.indexOf("{", m.index);
  const end = css.indexOf("}", start);
  if (start === -1 || end === -1) return null;
  return css.slice(start + 1, end);
}

/** Map of declared custom properties → value (last declaration wins). */
function parseDecls(blockText: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockText))) map.set(m[1]!, m[2]!.trim());
  return map;
}

function themeBlocks(css: string): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  const re = /html\[data-theme="([^"]+)"\]\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const start = css.indexOf("{", m.index);
    const end = css.indexOf("}", start);
    out[m[1]!] = new Set(parseDecls(css.slice(start + 1, end)).keys());
  }
  return out;
}

describe("theme parity", () => {
  for (const [app, path] of Object.entries(GLOBALS)) {
    describe(app, () => {
      const css = readFileSync(path, "utf8");
      const rootBody = blockBody(css, /:root\s*\{/) ?? "";
      const rootDecls = parseDecls(rootBody);
      const themes = themeBlocks(css);
      const ids = Object.keys(themes);

      // Themeable = literal color in :root, not a var() reference.
      const contract = [...rootDecls.entries()]
        .filter(([, v]) => COLOR_RE.test(v) && !/var\(/.test(v))
        .map(([k]) => k)
        .sort();

      it("has a :root contract and at least one theme block", () => {
        expect(contract.length).toBeGreaterThan(0);
        expect(ids.length).toBeGreaterThan(0);
      });

      it("every theme re-declares all themeable contract vars", () => {
        for (const id of ids) {
          const missing = contract.filter((v) => !themes[id]!.has(v));
          expect(
            missing,
            `[data-theme="${id}"] is missing themeable vars`,
          ).toEqual([]);
        }
      });

      it("no theme declares a var absent from :root (typo guard)", () => {
        const rootNames = new Set(rootDecls.keys());
        for (const id of ids) {
          const stray = [...themes[id]!].filter((v) => !rootNames.has(v));
          expect(stray, `[data-theme="${id}"] has stray vars`).toEqual([]);
        }
      });

      it("all theme blocks declare the same var set (no drift)", () => {
        if (ids.length < 2) return; // single theme: nothing to compare yet
        const ref = [...themes[ids[0]!]!].sort();
        for (const id of ids.slice(1)) {
          expect(
            [...themes[id]!].sort(),
            `[data-theme="${id}"] differs from [data-theme="${ids[0]}"]`,
          ).toEqual(ref);
        }
      });
    });
  }
});
