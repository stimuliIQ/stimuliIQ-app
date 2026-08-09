// apps/crm/e2e/two-factor-login-live.e2e.spec.ts
//
// The FULL 2FA login journey against a real API, end to end:
//   sign in -> nav to Two-Factor Auth (the new last side-nav item) -> enrol with a real
//   computed TOTP code -> sign out -> sign in again -> hit the 2FA gate -> enter a real
//   code -> land in the app -> always disable 2FA again.
//
// This is the journey two-factor-login-gate.e2e.spec.ts stubs. That spec proves the
// browser handles each server response correctly; this one proves the two halves actually
// meet — that the API really refuses a session at /auth/login for an enrolled account and
// really accepts one at /auth/2fa/login-verify.
//
// ─── WHY THIS IS DOUBLE-GATED ────────────────────────────────────────────────
// It ENROLS 2FA on a live account and disables it in a `finally`. If that cleanup ever
// fails to run, the account is left needing an authenticator nobody has — which is the
// exact lockout this whole change fixes, re-created by its own test. Against a
// production-pointed API that would be a real person locked out of a real system.
//
// So it requires BOTH:
//   QA_ADMIN_PASSWORD      — credentials for a disposable staff account
//   QA_ALLOW_DESTRUCTIVE=1 — an explicit "yes, this API is safe to mutate"
//
// The second is not redundant. A developer who exports QA_ADMIN_PASSWORD once tends to
// keep it exported; the opt-in has to be a separate, deliberate act each time the target
// API changes. Never set it while VITE_API_URL / the local API points at production.
import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;
const DESTRUCTIVE_OK = process.env.QA_ALLOW_DESTRUCTIVE === "1";

// RFC 6238, self-contained — mirrors apps/api/src/modules/auth/lib/totp.ts's algorithm
// (HMAC-SHA1, 30s step, 6 digits) rather than importing across the api/crm package
// boundary, exactly as two-factor-enroll.e2e.spec.ts does.
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.toUpperCase().replace(/=+$/, "")) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateTotpCode(secretBase32: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

test.describe("2FA login gate — live API", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD.");
  test.skip(
    !DESTRUCTIVE_OK,
    "Requires QA_ALLOW_DESTRUCTIVE=1 — this spec enrols 2FA on a live account. Never set it against production.",
  );

  test("enrolling forces the code step on the next sign-in, and a real TOTP code gets through", async ({ page }) => {
    // ── sign in (no 2FA yet) ────────────────────────────────────────────────
    await page.goto("/login");
    await page.locator("#login-email").fill(ADMIN_EMAIL);
    await page.locator("#login-password").fill(ADMIN_PASSWORD!);
    await page.getByTestId("login-submit").click();
    // Vite/TanStack SPA pushState — no `load` event fires, so assert on DOM state rather
    // than waiting for navigation (same constraint as two-factor-enroll.e2e.spec.ts).
    await expect(page.getByTestId("login-card")).not.toBeVisible({ timeout: 15_000 });

    // ── the new last side-nav item routes to the dedicated page ─────────────
    await page.getByTestId("nav-item-two-factor auth").click();
    await expect(page.getByTestId("account-two-factor-page")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/account\/two-factor$/);

    const alreadyEnabled = await page.getByTestId("two-factor-enabled").isVisible().catch(() => false);
    test.skip(alreadyEnabled, "Account already has 2FA enabled from a prior run — clean up before re-running.");

    let secret: string | undefined;
    try {
      // ── enrol ─────────────────────────────────────────────────────────────
      await page.getByTestId("two-factor-enroll-button").click();
      await expect(page.getByTestId("two-factor-enrolling")).toBeVisible();
      secret = await page.getByTestId("two-factor-secret").inputValue();
      expect(secret).toMatch(/^[A-Z2-7]+$/);

      await page.getByTestId("two-factor-verify-code-input").fill(generateTotpCode(secret));
      await page.getByTestId("two-factor-verify-button").click();
      await expect(page.getByTestId("two-factor-backup-codes")).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("two-factor-backup-codes").getByRole("button", { name: /done/i }).click();
      await expect(page.getByTestId("two-factor-enabled")).toBeVisible();

      // ── sign out ──────────────────────────────────────────────────────────
      await page.getByTestId("account-menu-trigger").click();
      await page.getByTestId("topbar-logout").click();
      await expect(page.getByTestId("login-card")).toBeVisible({ timeout: 15_000 });

      // ── sign in again: the server must now REFUSE a session here ──────────
      await page.locator("#login-email").fill(ADMIN_EMAIL);
      await page.locator("#login-password").fill(ADMIN_PASSWORD!);
      await page.getByTestId("login-submit").click();

      // THE REGRESSION: correct credentials, but the code step — not "Incorrect email or
      // password", and not a session.
      await expect(page.getByTestId("login-2fa-card")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Incorrect email or password.")).toHaveCount(0);

      // A wrong code is rejected by the real API without losing the step.
      await page.getByTestId("login-2fa-code-input").fill("000000");
      await page.getByTestId("login-2fa-submit").click();
      await expect(page.getByTestId("login-2fa-error")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("login-2fa-card")).toBeVisible();

      // A real code gets through.
      await page.getByTestId("login-2fa-code-input").fill(generateTotpCode(secret));
      await page.getByTestId("login-2fa-submit").click();
      await expect(page.getByTestId("login-2fa-card")).not.toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("app-shell")).toBeVisible();
    } finally {
      // ALWAYS disable — never leave the account 2FA-gated. Best-effort: if the run died
      // mid-journey we may be signed out, so sign back in through the gate first.
      if (secret) {
        try {
          if (await page.getByTestId("login-card").isVisible().catch(() => false)) {
            await page.locator("#login-email").fill(ADMIN_EMAIL);
            await page.locator("#login-password").fill(ADMIN_PASSWORD!);
            await page.getByTestId("login-submit").click();
            await page.getByTestId("login-2fa-code-input").fill(generateTotpCode(secret));
            await page.getByTestId("login-2fa-submit").click();
            await expect(page.getByTestId("login-2fa-card")).not.toBeVisible({ timeout: 15_000 });
          }
          await page.goto("/account/two-factor");
          const disableInput = page.getByTestId("two-factor-disable-code-input");
          if (await disableInput.isVisible().catch(() => false)) {
            await disableInput.fill(generateTotpCode(secret));
            await page.getByTestId("two-factor-disable-button").click();
            await expect(page.getByTestId("two-factor-disabled")).toBeVisible({ timeout: 10_000 });
          }
        } catch {
          // Surfaced loudly rather than swallowed silently: a failed cleanup leaves a real
          // account locked out, and the operator needs to know to fix it by hand.
          console.error(
            `[two-factor-login-live] CLEANUP FAILED — ${ADMIN_EMAIL} may still have 2FA enabled. ` +
              `Disable it manually (TOTP secret for this run: ${secret}).`,
          );
        }
      }
    }
  });
});
