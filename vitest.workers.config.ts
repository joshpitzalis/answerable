import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflareTest({
      main: process.env.PROJECT_WORKER_ENTRY ?? "./src/app/projectHarvest.ts",
      miniflare: {
        compatibilityDate: "2026-11-16",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          PROJECT_HARVEST: { className: "ProjectHarvest", useSQLite: true },
        },
      },
    }),
  ],
  test: { include: ["src/**/__tests__/**/*.workers.test.ts"] },
});
