import { defineConfig, devices } from "@playwright/test";

// Pinned by `dev.port` and `dev.strictPort` in alchemy.run.ts.
const BASE_URL = "http://localhost:1337";

export default defineConfig({
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  testDir: "e2e",
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  webServer: {
    // The empty env file leaves DISCORD_BOT_TOKEN unset, so the app serves the
    // captured fixture instead of live Discord.
    command: "pnpm exec alchemy dev --no-input --env-file e2e/e2e.env",
    // A dev server started by hand may hold a real token and live data.
    reuseExistingServer: false,
    timeout: 120_000,
    url: BASE_URL,
  },
});
