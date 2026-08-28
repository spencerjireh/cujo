import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Both roots while the tests move out of src/; narrowed to tests/ after.
    include: ["src/**/*.contract.test.ts", "tests/**/*.contract.test.ts"],
    // One server, one session: the tests build on each other in order.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
