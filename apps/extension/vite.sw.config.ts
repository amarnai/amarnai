import { defineConfig } from "vite";
import path from "node:path";
import { OUT_DIR } from "./vite.config";

// Service-worker build: a second pass so the worker lands at a fixed path
// (<outDir>/service-worker.js) as a single ES module, with no shared hashed
// chunks that MV3 could not resolve. On Firefox this same file is the event-page
// background script. emptyOutDir:false so it does not wipe the panel build's
// output (the panel build runs first and owns emptyOutDir). OUT_DIR is shared
// with vite.config.ts so both passes target the same per-browser directory.
export default defineConfig({
  build: {
    outDir: OUT_DIR,
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/background/service-worker.ts"),
      formats: ["es"],
      fileName: () => "service-worker.js",
    },
    rollupOptions: {
      output: { entryFileNames: "service-worker.js" },
    },
  },
});
