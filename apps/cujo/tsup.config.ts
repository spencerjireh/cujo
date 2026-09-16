import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Bundle every dependency so the runtime image needs no node_modules.
  noExternal: [/(.*)/],
  // A bundled CommonJS dependency still calls `require` at load (`yaml` asks
  // for `process`), and esbuild's ESM shim throws for it: the image built,
  // the container exited on its first line, and the deploy that carried
  // decision 161 took the app down. The banner gives the bundle a real
  // `require`, which the shim uses when one exists.
  banner: {
    js: "import { createRequire as __cujoCreateRequire } from 'node:module';\nconst require = __cujoCreateRequire(import.meta.url);",
  },
});
