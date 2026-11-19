import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: "./vitest.config.ts",
        test: { maxWorkers: 1, testTimeout: 30_000 },
      },
      {
        extends: "./vitest.workers.config.ts",
        test: { maxWorkers: 1, testTimeout: 30_000 },
      },
    ],
  },
});
