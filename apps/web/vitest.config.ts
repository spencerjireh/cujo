import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mostly data-layer units: the API client, the run-stream reducer, report
// narrowing, and markdown sanitizing are all pure functions, and they run in the
// node environment with the hoisted root vitest.
//
// One component is tested here too, and it is the exception rather than the new
// rule: `Record` decides what it draws — a floor of empty rules, a ceiling, a
// keyboard-reachable scrollport, which of two empty states — from state no pure
// function owns, and a story can only show that to a person. Everything else is
// still verified in Storybook and in the browser. A component test file says so
// by asking for jsdom in its own docblock; nothing else pays for it.
export default defineConfig({
  // tsconfig.json declares `@/*` but vitest does not read tsconfig paths, so
  // the alias is repeated here. Tests live outside src/ and would otherwise
  // reach their subjects through a chain of `../`.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Next's tsconfig sets `jsx: "preserve"` for its own compiler, which would
  // leave JSX in the output for vitest to choke on. The automatic runtime here
  // is what a `.tsx` test needs, and it costs no plugin and no second vitest.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
