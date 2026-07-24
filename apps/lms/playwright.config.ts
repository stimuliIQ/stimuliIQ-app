// Playwright config for @stimuliiq/lms (R13, docs/plans/phase-9-completion.md T41).
// Journeys covered here: support-ticket create (own-scope), live-class list/join.
//
// Uses this app's CONVENTIONAL dev port (3001), unlike apps/web/playwright.config.ts's
// deliberate port shift — the already-running API process's CORS allowlist (main.ts,
// built from `LMS_APP_URL` at ITS boot time) only permits `http://localhost:3001` as an
// origin; a browser-side (not server-side-RSC) login POST from any other port is
// silently rejected by CORS. `reuseExistingServer: false` still applies (never reuse a
// same-port process without knowing what it is) — verified free before adopting this
// port.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3001;
const BASE_URL = process.env.LMS_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
