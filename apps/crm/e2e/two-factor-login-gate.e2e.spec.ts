// apps/crm/e2e/two-factor-login-gate.e2e.spec.ts
//
// Covers the 2FA LOGIN GATE and the lost-authenticator RECOVERY flow in a real browser,
// against the real Vite bundle, real TanStack Router and real react-hook-form.
//
// REGRESSION ANCHOR: `auth.2fa_required` is an HTTP 401, and LoginForm's catch-all used
// to render every 401 as "Incorrect email or password" — with no code field anywhere in
// the app. Enrolling in 2FA therefore locked a staff account out permanently. The first
// test below is the guard against that returning.
//
// WHY THIS SPEC STUBS THE API (the only one in the repo that does)
// Every other e2e here drives a live API. This one cannot, for two reasons:
//   1. The journey's WHOLE POINT is a family of server responses that are awkward to
//      provoke on demand — 2FA-required, wrong TOTP, a mailed recovery code (whose value
//      only ever exists inside an email), and a successful factor removal.
//   2. Provoking them for real means enrolling and then stripping 2FA on a live staff
//      account. Against a shared or production-pointed API that is exactly the lockout
//      this change fixes, re-created by the test for it.
// So the SERVER contract is verified where it belongs — in
// apps/api/src/modules/auth/two-factor-recovery.service.spec.ts and the permission-catalog
// spec — and this spec verifies the CLIENT half: that the browser does the right thing
// with each of those responses. two-factor-login-live.e2e.spec.ts drives the same
// journey end-to-end against a real API when one is safely available.
//
// Because nothing here touches a database, this spec is safe to run anywhere.
import { test, expect, type Page } from "@playwright/test";

const API = "**/api/v1";

/** The `{ data, meta, error }` envelope every endpoint returns (@repo/types buildEnvelopeSchema). */
function envelope(data: unknown) {
  return JSON.stringify({ data, meta: null, error: null });
}

function problemEnvelope(status: number, code: string, title: string, detail?: string) {
  return JSON.stringify({ data: null, meta: null, error: { status, code, title, detail, type: "about:blank" } });
}

/**
 * Signed-out shell: GET /me must 401 so AppShell renders the login card, and the SDK's
 * onUnauthorized refresh attempt must also fail — otherwise it retries in a loop.
 */
async function stubSignedOut(page: Page) {
  await page.route(`${API}/me`, (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: problemEnvelope(401, "auth.unauthenticated", "Unauthenticated") }),
  );
  await page.route(`${API}/auth/refresh`, (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: problemEnvelope(401, "auth.unauthenticated", "Unauthenticated") }),
  );
}

async function fillCredentials(page: Page) {
  // By id, not getByLabel: the password show/hide toggle carries an aria-label containing
  // "password", so getByLabel("Password") is ambiguous under Playwright strict mode.
  await page.locator("#login-email").fill("priya@stimuliiq.com");
  await page.locator("#login-password").fill("Sup3rSecret!x");
  await page.getByTestId("login-submit").click();
}

test.describe("2FA login gate", () => {
  test.beforeEach(async ({ page }) => {
    await stubSignedOut(page);
  });

  test("a 2FA-enrolled account is shown the CODE step, never 'Incorrect email or password'", async ({ page }) => {
    await page.route(`${API}/auth/login`, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: problemEnvelope(401, "auth.2fa_required", "Two-factor authentication required"),
      }),
    );

    await page.goto("/login");
    await fillCredentials(page);

    await expect(page.getByTestId("login-2fa-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("login-2fa-code-input")).toBeVisible();
    // The lockout bug, in one assertion.
    await expect(page.getByText("Incorrect email or password.")).toHaveCount(0);
  });

  test("an ordinary bad password still shows the generic credentials error", async ({ page }) => {
    await page.route(`${API}/auth/login`, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: problemEnvelope(401, "auth.invalid_credentials", "Invalid email or password"),
      }),
    );

    await page.goto("/login");
    await fillCredentials(page);

    await expect(page.getByTestId("login-error")).toHaveText("Incorrect email or password.");
    await expect(page.getByTestId("login-2fa-card")).toHaveCount(0);
  });

  test("a correct code completes the login; the credentials are re-sent with audience=crm", async ({ page }) => {
    await page.route(`${API}/auth/login`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: problemEnvelope(401, "auth.2fa_required", "Two-factor authentication required") }),
    );

    let verifyBody: Record<string, unknown> | undefined;
    await page.route(`${API}/auth/2fa/login-verify`, (route) => {
      verifyBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: envelope({ user: { id: "u1", name: "Priya", email: "priya@stimuliiq.com", roles: ["admin"] }, csrfToken: "csrf-1" }),
      });
    });

    await page.goto("/login");
    await fillCredentials(page);
    await page.getByTestId("login-2fa-code-input").fill("123456");
    await page.getByTestId("login-2fa-submit").click();

    await expect
      .poll(() => verifyBody, { timeout: 15_000 })
      .toMatchObject({ email: "priya@stimuliiq.com", password: "Sup3rSecret!x", code: "123456", audience: "crm" });
  });

  test("a wrong code keeps the user on the code step instead of dropping them back to the password", async ({ page }) => {
    await page.route(`${API}/auth/login`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: problemEnvelope(401, "auth.2fa_required", "Two-factor authentication required") }),
    );
    await page.route(`${API}/auth/2fa/login-verify`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: problemEnvelope(401, "TOTP_CODE_INVALID", "Invalid two-factor code") }),
    );

    await page.goto("/login");
    await fillCredentials(page);
    await page.getByTestId("login-2fa-code-input").fill("000000");
    await page.getByTestId("login-2fa-submit").click();

    await expect(page.getByTestId("login-2fa-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("login-2fa-card")).toBeVisible();
    await expect(page.getByTestId("login-card")).toHaveCount(0);
  });
});

test.describe("2FA recovery — lost authenticator", () => {
  test.beforeEach(async ({ page }) => {
    await stubSignedOut(page);
    await page.route(`${API}/auth/login`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: problemEnvelope(401, "auth.2fa_required", "Two-factor authentication required") }),
    );
  });

  /** credentials -> code step -> "Lost your authenticator?" */
  async function reachRecovery(page: Page) {
    await page.goto("/login");
    await fillCredentials(page);
    await page.getByTestId("login-2fa-lost-device").click();
    await expect(page.getByTestId("login-recovery-request-card")).toBeVisible({ timeout: 15_000 });
  }

  test("warns that recovery removes a factor before sending anything", async ({ page }) => {
    await reachRecovery(page);
    await expect(page.getByTestId("login-recovery-warning")).toBeVisible();
  });

  test("requests a code with the stashed credentials, then never claims an email was definitely sent", async ({ page }) => {
    let requestBody: Record<string, unknown> | undefined;
    await page.route(`${API}/auth/2fa/recovery/request`, (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 200, contentType: "application/json", body: envelope({ message: "generic" }) });
    });

    await reachRecovery(page);
    await page.getByTestId("login-recovery-request-submit").click();

    await expect(page.getByTestId("login-recovery-code-card")).toBeVisible({ timeout: 15_000 });
    expect(requestBody).toMatchObject({ email: "priya@stimuliiq.com", password: "Sup3rSecret!x", audience: "crm" });
    // The API's response is identical whether or not the account exists — the copy must
    // stay hedged, or the UI leaks what the API deliberately withholds.
    await expect(page.getByTestId("login-recovery-code-card")).toContainText(/if an account exists/i);
  });

  test("a valid code turns 2FA off, returns to the password step, and issues NO session", async ({ page }) => {
    await page.route(`${API}/auth/2fa/recovery/request`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: envelope({ message: "generic" }) }),
    );
    let loginVerifyCalled = false;
    await page.route(`${API}/auth/2fa/login-verify`, (route) => {
      loginVerifyCalled = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: envelope({ user: {}, csrfToken: "x" }) });
    });
    await page.route(`${API}/auth/2fa/recovery/confirm`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: envelope({ reset: true }) }),
    );

    await reachRecovery(page);
    await page.getByTestId("login-recovery-request-submit").click();
    await page.getByTestId("login-recovery-code-input").fill("654321");
    await page.getByTestId("login-recovery-code-submit").click();

    // Back to stage one with a re-enrol prompt — recovery deliberately does not log in.
    await expect(page.getByTestId("login-notice")).toContainText(/set up your authenticator app again/i, { timeout: 15_000 });
    await expect(page.getByTestId("login-card")).toBeVisible();
    expect(loginVerifyCalled).toBe(false);
  });

  test("a rejected recovery code keeps the user on the code step", async ({ page }) => {
    await page.route(`${API}/auth/2fa/recovery/request`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: envelope({ message: "generic" }) }),
    );
    await page.route(`${API}/auth/2fa/recovery/confirm`, (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: problemEnvelope(422, "RECOVERY_CODE_INVALID", "That recovery code is invalid or has expired"),
      }),
    );

    await reachRecovery(page);
    await page.getByTestId("login-recovery-request-submit").click();
    await page.getByTestId("login-recovery-code-input").fill("000000");
    await page.getByTestId("login-recovery-code-submit").click();

    await expect(page.getByTestId("login-recovery-code-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("login-recovery-code-card")).toBeVisible();
  });
});
