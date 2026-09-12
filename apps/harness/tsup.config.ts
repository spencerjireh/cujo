import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // The workspace packages export TypeScript source, so they are inlined; pi
  // and the MCP SDK stay external (pi carries wasm and a loader that a bundle
  // breaks), so the runtime image ships node_modules.
  noExternal: [/^@cujo\//],
});
