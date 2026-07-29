import { defineConfig, devices } from "@playwright/test";

import { DEV_ORIGIN, DEV_PORT } from "./devPort";

export default defineConfig({
  testDir: "./e2e",
  // Refuses to run against an origin owned by another app — the failure mode
  // that made a port conflict look like a total suite wipeout (issue #72).
  globalSetup: "./e2e/preflight.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: DEV_ORIGIN,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // The SPA talks to a Frappe backend; tests stub the network (see e2e/fixtures.ts),
  // so the dev server is all we need. FRAPPE_PROXY points nowhere real on purpose —
  // every /api/method/** call is intercepted before it reaches the proxy.
  webServer: {
    command: "npm run dev",
    url: DEV_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // PORT is passed explicitly rather than relying on env inheritance, so the
    // port Vite listens on is visibly the same one baseURL points at.
    env: { FRAPPE_PROXY: "http://127.0.0.1:9", PORT: String(DEV_PORT) },
  },
});
