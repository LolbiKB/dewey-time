import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || "8080";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE,
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
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { FRAPPE_PROXY: "http://127.0.0.1:9" },
  },
});
