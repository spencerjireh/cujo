import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.contract.test.ts"],
    // One server, one session: the tests build on each other in order.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
