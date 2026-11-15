import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Only the Workers runtime provides this module. Tests get an empty env,
      // so the question-finder runtime falls back to its stub services.
      "cloudflare:workers": fileURLToPath(
        new URL("src/shared/testing/cloudflareWorkers.ts", import.meta.url)
      ),
    },
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
  },
});
