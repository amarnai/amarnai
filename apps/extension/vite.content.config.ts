import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { OUT_DIR } from "./vite.config";

// Content-script build. One pass per provider, selected with CONTENT_TARGET, so
// each lands at a fixed path (<outDir>/content-<provider>.js) that the manifest
// can reference. Mirrors vite.sw.config.ts:
//
//   - IIFE, not ES module: a manifest content script is not a module, and code
//     splitting would produce chunks the browser cannot resolve for it.
//   - emptyOutDir:false so these passes do not wipe the panel build's output
//     (the panel build runs first and owns emptyOutDir).
//   - OUT_DIR shared with the other configs so every pass targets the same
//     per-browser directory.

const TARGET = process.env["CONTENT_TARGET"] === "outlook" ? "outlook" : "gmail";

/**
 * InboxSDK runs part of itself in the page's own JS world (Gmail's), which it
 * reaches by loading pageWorld.js as a web-accessible resource. It is shipped as
 * a prebuilt file in the package rather than something we can bundle, so copy it
 * verbatim into the output next to the content script that loads it.
 *
 * Gmail-only: the Outlook content script never loads InboxSDK. Skipped under the
 * build-time kill-switch too — that build declares no content scripts, so
 * emitting half a megabyte nothing can reference is pure dead weight.
 */
function emitInboxSdkPageWorld(): Plugin {
  return {
    name: "aziru-emit-pageworld",
    generateBundle() {
      const require = createRequire(import.meta.url);
      const source = fs.readFileSync(
        path.join(path.dirname(require.resolve("@inboxsdk/core/package.json")), "pageWorld.js"),
        "utf8",
      );
      this.emitFile({ type: "asset", fileName: "pageWorld.js", source });
    },
  };
}

const NATIVE_INJECTION = process.env["VITE_DISABLE_NATIVE_INJECTION"] !== "1";

export default defineConfig({
  plugins: TARGET === "gmail" && NATIVE_INJECTION ? [emitInboxSdkPageWorld()] : [],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, `src/content/${TARGET}/index.ts`),
      formats: ["iife"],
      name: "AziruContent",
      fileName: () => `content-${TARGET}.js`,
    },
    rollupOptions: {
      output: { entryFileNames: `content-${TARGET}.js`, extend: true },
    },
  },
});
