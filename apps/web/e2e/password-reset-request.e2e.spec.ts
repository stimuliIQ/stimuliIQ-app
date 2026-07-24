// apps/web/e2e/password-reset-request.e2e.spec.ts
//
// R13 critical-journey e2e (docs/plans/phase-9-completion.md T41): password-reset
// request (B9/T28).
//
// DEFECT FLAGGED (found while writing this spec, reported to the QA summary): there is
// NO frontend UI anywhere in web/lms/crm for this journey — no "Forgot password?" link
// on any login page (apps/web, apps/lms, apps/crm all checked), and no
// `/reset-password` page exists in apps/lms despite `PasswordResetService.request()`
// (apps/api/src/modules/auth/password-reset.service.ts) building its email link as
// `${LMS_APP_URL}/reset-password?token=...` — a real user who receives the reset email
// and clicks the link lands on a 404. The BACKEND flow itself is fully built and
// integration-tested end-to-end (apps/api/test/integration/
// phase-9-auth-lifecycle.integration-spec.ts covers request -> confirm -> single-use).
//
// Until a UI exists to click through, this spec exercises the REAL HTTP contract
// directly via Playwright's `request` fixture (an API-level Playwright test, not a
// browser journey) — this is the closest honest "e2e" coverage available for this
// journey today, and will need converting to a real `page.goto()`/`page.click()` flow
// once the frontend page ships.
import { test, expect } from "@playwright/test";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";

test.describe("Password reset — request (API-level; NO frontend page exists yet — see file header)", () => {
  test("the /reset-password landing page referenced by the reset email does not exist (404) — tracked defect, not a passing assertion of intended behavior", async ({ page }) => {
    const res = await page.goto("http://localhost:3100/reset-password?token=whatever", { waitUntil: "domcontentloaded" }).catch(() => null);
    test.skip(!res, "web dev server not reachable on :3100 for this run");
    if (!res) return;
    expect(res.status()).toBe(404);
  });

  test("POST /auth/password-reset/request is always 200 (enumeration-resistant) for a real AND a fake email", async ({ request }) => {
    const health = await request.get(`${API_BASE_URL}/api/v1/health/ready`).catch(() => null);
    test.skip(!health || !health.ok(), "API not reachable at " + API_BASE_URL);
    if (!health || !health.ok()) return;

    const real = await request.post(`${API_BASE_URL}/api/v1/auth/password-reset/request`, {
      data: { email: "admin@stimuliiq.test" },
    });
    expect(real.status()).toBe(200);
    const realBody = (await real.json()).data as { message: string };

    const fake = await request.post(`${API_BASE_URL}/api/v1/auth/password-reset/request`, {
      data: { email: "definitely-not-a-real-account@stimuliiq.test" },
    });
    expect(fake.status()).toBe(200);
    const fakeBody = (await fake.json()).data as { message: string };

    // Enumeration resistance: byte-identical response for a real vs. fake account.
    expect(realBody.message).toBe(fakeBody.message);
  });

  test("POST /auth/password-reset/confirm with a fabricated token -> 422 TOKEN_INVALID_OR_EXPIRED", async ({ request }) => {
    const health = await request.get(`${API_BASE_URL}/api/v1/health/ready`).catch(() => null);
    test.skip(!health || !health.ok(), "API not reachable at " + API_BASE_URL);
    if (!health || !health.ok()) return;

    const res = await request.post(`${API_BASE_URL}/api/v1/auth/password-reset/confirm`, {
      data: { token: "fabricated-token-xyz", newPassword: "Some-New-Passw0rd!" },
    });
    expect(res.status()).toBe(422);
    const body = (await res.json()).error as { code: string };
    expect(body.code).toBe("TOKEN_INVALID_OR_EXPIRED");
  });
});
