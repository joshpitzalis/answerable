import { defineConfig, devices } from "@playwright/test";

// Its own port, so e2e can run while `pnpm dev` holds 1337.
const E2E_PORT = process.env.E2E_PORT ?? "1338";
const BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  testDir: "e2e",
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  webServer: {
    // The empty env file leaves DISCORD_BOT_TOKEN unset, so the app serves the
    // captured fixture instead of live Discord. `DEV_PORT` is read by
    // alchemy.run.ts, which pins the port with `strictPort`.
    command: "pnpm exec alchemy dev --no-input --env-file e2e/e2e.env",
    env: { DEV_PORT: E2E_PORT },
    // A dev server started by hand may hold a real token and live data.
    reuseExistingServer: false,
    timeout: 120_000,
    url: BASE_URL,
  },
});
