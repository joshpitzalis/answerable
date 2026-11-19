import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import { workerBuild } from "./src/app/worker.config.ts";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflareTest({
      main: process.env.PROJECT_WORKER_ENTRY ?? "./src/app/projectHarvest.ts",
      miniflare: {
        compatibilityDate: workerBuild.compatibilityDate,
        compatibilityFlags: workerBuild.compatibilityFlags,
        durableObjects: {
          PROJECT_HARVEST: { className: "ProjectHarvest", useSQLite: true },
        },
      },
    }),
  ],
  test: { name: "workers", include: ["src/**/__tests__/**/*.workers.test.ts"] },
});
