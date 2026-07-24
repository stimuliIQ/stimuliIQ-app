// Playwright config for @stimuliiq/crm (R13, docs/plans/phase-9-completion.md T41).
// Journey covered here: 2FA (TOTP) enrol (T28/T40).
//
// Uses this app's CONVENTIONAL dev port (3002) — the already-running API process's CORS
// allowlist (apps/api/src/main.ts, built from `CRM_APP_URL` at ITS boot time) only
// permits `http://localhost:3002` as a browser-side origin (see apps/lms/playwright.
// config.ts's header for the same constraint hit on the LMS port). `reuseExistingServer`
// is locally-on (verified this port serves the REAL crm app, not an unrelated project,
// before adopting it — see apps/web/playwright.config.ts's header for why that check
// matters on a shared machine) and forced fresh in CI.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3002;
const BASE_URL = process.env.CRM_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.spec\.ts/,
  fullyParallel: false, // 2FA enroll/verify is stateful per-account; keep serial for this small suite.
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
    command: `npx vite --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
