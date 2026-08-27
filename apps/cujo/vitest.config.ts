import { defineConfig } from "vitest/config";

// Unit tests only. The harness contract tests need a running TrueForge
// server and run through vitest.contract.config.ts (`make test-int`).
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.contract.test.ts"],
  },
});
