import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Bundle every dependency into the output so the runtime image needs no
  // node_modules.
  noExternal: [/(.*)/],
  // A bundled CommonJS dependency still calls `require` at load, and esbuild's
  // ESM shim throws for it: the image builds, and the container exits on its
  // first line. That is what took the app down on 2026-09-17, and decision 168
  // gave `apps/cujo` this banner for it. The other three services bundle the
  // same way and were left without one, so the next CommonJS dependency any of
  // them gains would have done it again.
  banner: {
    js: "import { createRequire as __cujoCreateRequire } from 'node:module';\nconst require = __cujoCreateRequire(import.meta.url);",
  },
});
