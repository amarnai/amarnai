import { defineConfig } from "vite";
import path from "node:path";
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

export default defineConfig({
  build: {
    outDir: OUT_DIR,
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, `src/content/${TARGET}/index.ts`),
      formats: ["iife"],
      name: "AmarnaiContent",
      fileName: () => `content-${TARGET}.js`,
    },
    rollupOptions: {
      output: { entryFileNames: `content-${TARGET}.js`, extend: true },
    },
  },
});
