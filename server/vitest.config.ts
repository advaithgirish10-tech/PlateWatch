import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    /* the files share one test database */
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
