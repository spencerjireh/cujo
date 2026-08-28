import { defineConfig } from "vitest/config";

// Data-layer units only: the API client, the run-stream reducer, report
// narrowing, and markdown sanitizing are all pure functions, so these run in
// the node environment with the hoisted root vitest and need no jsdom, no React
// plugin, and no second vitest major in the repo. Components are verified in
// Storybook and in the browser instead.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
