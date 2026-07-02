import { defineConfig } from "vite";
import path from "node:path";

// Service-worker build: a second pass so the worker lands at a fixed path
// (dist/service-worker.js) as a single ES module, with no shared hashed chunks
// that MV3 could not resolve. emptyOutDir:false so it does not wipe the panel
// build's output (the panel build runs first and owns emptyOutDir).
export default defineConfig({
  build: {
    outDir: "dist",
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
