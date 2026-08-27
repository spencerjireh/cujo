import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Bundle every dependency into the output so the runtime image needs no
  // node_modules.
  noExternal: [/(.*)/],
});
