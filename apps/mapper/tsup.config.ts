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
  // first line (decision 168). Every service that bundles this way carries the
  // banner, and a new one starts with it rather than waiting to learn why.
  banner: {
    js: "import { createRequire as __cujoCreateRequire } from 'node:module';\nconst require = __cujoCreateRequire(import.meta.url);",
  },
});
