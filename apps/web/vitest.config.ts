import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Data-layer units only: the API client, the run-stream reducer, report
// narrowing, and markdown sanitizing are all pure functions, so these run in
// the node environment with the hoisted root vitest and need no jsdom, no React
// plugin, and no second vitest major in the repo. Components are verified in
// Storybook and in the browser instead.
export default defineConfig({
  // tsconfig.json declares `@/*` but vitest does not read tsconfig paths, so
  // the alias is repeated here. Tests live outside src/ and would otherwise
  // reach their subjects through a chain of `../`.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Both roots while the tests move out of src/; narrowed to tests/ after.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
