/**
 * Single source of truth for the dev-server port.
 *
 * `vite.config.ts` and `playwright.config.ts` BOTH import this. They used to
 * carry the port independently — Playwright read `process.env.PORT`, Vite
 * hardcoded 8080 — which made `PORT=8099 npm run test:e2e` a trap: it moved
 * Playwright's baseURL but not Vite's listen port, so the suite pointed at
 * nothing. Threading one value through both is what makes that escape hatch
 * real. See issue #72.
 */

const raw = process.env.PORT?.trim();

if (raw !== undefined && raw !== "" && !/^\d+$/.test(raw)) {
  throw new Error(`PORT must be a number, got ${JSON.stringify(raw)}`);
}

export const DEV_PORT = raw ? Number(raw) : 8080;

if (!Number.isInteger(DEV_PORT) || DEV_PORT < 1 || DEV_PORT > 65535) {
  throw new Error(`PORT must be between 1 and 65535, got ${DEV_PORT}`);
}

export const DEV_ORIGIN = `http://localhost:${DEV_PORT}`;
