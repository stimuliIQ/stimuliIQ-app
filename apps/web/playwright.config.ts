// Playwright config for @stimuliiq/web (R13, docs/plans/phase-9-completion.md T41).
// Journeys covered here: certificate verify (real UI, B10), password-reset request
// (API-level — see password-reset-request.e2e.spec.ts's header for why there is no UI
// journey to click through yet).
//
// `webServer` reuses an already-running `pnpm --filter @stimuliiq/web dev` (port 3000)
// when present (matches this repo's local-dev/this-sandbox reality — the dev server was
// already up when this config was authored) and otherwise starts one. In CI,
// `reuseExistingServer` is forced false so a stale/foreign process on :3000 is never
// silently reused.
import { defineConfig, devices } from "@playwright/test";

// NOTE: deliberately NOT the app's usual dev port (3000) — this machine may have an
// UNRELATED project's dev server already bound to 3000 (observed in this sandbox: a
// different app entirely was listening there). Always boots a fresh, DEDICATED instance
// on a distinct port for the e2e run rather than risking `reuseExistingServer` silently
// attaching to the wrong process and producing confusing 404s that look like app bugs.
const PORT = 3100;
const BASE_URL = process.env.WEB_BASE_URL ?? `http://localhost:${PORT}`;

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
    // Always fresh — see the PORT comment above for why reusing a same-port process on
    // a shared/multi-project machine is unsafe here.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
