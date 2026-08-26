import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Bundle the workspace package into the output so the runtime image needs no
  // node_modules.
  noExternal: ["@cujo/gh-app-auth"],
});
