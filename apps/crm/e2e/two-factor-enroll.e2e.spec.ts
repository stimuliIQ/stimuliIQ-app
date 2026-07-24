// apps/crm/e2e/two-factor-enroll.e2e.spec.ts
//
// R13 critical-journey e2e (docs/plans/phase-9-completion.md T41): 2FA (TOTP) enrol,
// via the real Settings > Two-factor tab UI (T28/T40 — apps/crm/src/components/admin/
// two-factor-panel.tsx, mounted at /admin/settings).
//
// SERVER-DEPENDENT: requires a real running API + this app's dev server + a real staff
// account. Uses the seeded `admin@stimuliiq.test` account by default — CAUTION: this
// test ENROLS AND THEN DISABLES 2FA on whatever account it runs against, in a `finally`
// block, so it never leaves the account permanently 2FA-gated for other concurrent
// work/agents against a SHARED dev environment. Override QA_ADMIN_EMAIL/PASSWORD to
// point at a disposable account instead if that matters for your environment.
//
// TOTP codes are computed with a minimal, self-contained RFC 6238 implementation
// (mirrors apps/api/src/modules/auth/lib/totp.ts's algorithm — HMAC-SHA1, 30s step,
// 6 digits) rather than importing across the api/crm package boundary, so this spec has
// no dependency on apps/api's internals beyond the wire contract it already tests.
import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.toUpperCase().replace(/=+$/, "")) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secretBase32: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter % 0x100000000, 4);

  const key = base32Decode(secretBase32);
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

test.describe("2FA (TOTP) — enrol via Settings > Two-factor tab", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD env var.");

  test("enrol shows a QR code + secret; a REAL computed TOTP code activates 2FA; the panel then offers disable — always cleaned up", async ({ page }) => {
    await page.goto("/login");
    // By id, not getByLabel: the password show/hide toggle button carries an
    // aria-label containing "password", so getByLabel("Password") is ambiguous
    // and fails Playwright's strict mode.
    await page.locator("#login-email").fill(ADMIN_EMAIL);
    await page.locator("#login-password").fill(ADMIN_PASSWORD!);
    await page.getByTestId("login-card").getByRole("button", { name: /sign in/i }).click();
    // Vite/TanStack Router SPA client-side navigation (pushState, no full page `load`
    // event) — `page.waitForURL()`'s default `waitUntil: "load"` never resolves for
    // this kind of transition. Wait for the login card to disappear instead (a DOM-state
    // assertion, not a navigation-event one).
    await expect(page.getByTestId("login-card")).not.toBeVisible({ timeout: 15_000 });

    await page.goto("/admin/settings");
    await page.getByTestId("settings-tab-two-factor").click();

    // If a PRIOR failed run left 2FA enabled, this spec can't re-enrol — bail cleanly
    // rather than getting stuck (matches this spec's own "always leave 2FA off" contract).
    const alreadyEnabled = await page.getByTestId("two-factor-enabled").isVisible().catch(() => false);
    test.skip(alreadyEnabled, "Account already has 2FA enabled from a prior run — clean up manually before re-running.");
    if (alreadyEnabled) return;

    let enrolledSecret: string | undefined;
    try {
      await expect(page.getByTestId("two-factor-disabled")).toBeVisible();
      await page.getByTestId("two-factor-enroll-button").click();

      await expect(page.getByTestId("two-factor-enrolling")).toBeVisible();
      await expect(page.getByTestId("two-factor-qr-code").or(page.getByTestId("two-factor-qr-loading"))).toBeVisible();
      const secret = await page.getByTestId("two-factor-secret").inputValue();
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      enrolledSecret = secret; // captured here (closure), read by the `finally` cleanup below

      const code = generateTotpCode(secret);
      await page.getByTestId("two-factor-verify-code-input").fill(code);
      await page.getByTestId("two-factor-verify-button").click();

      const backupCodes = page.getByTestId("two-factor-backup-codes");
      await expect(backupCodes).toBeVisible({ timeout: 10_000 });
      expect(await backupCodes.locator("li").count()).toBeGreaterThan(0);
      await backupCodes.getByRole("button", { name: /done/i }).click();

      await expect(page.getByTestId("two-factor-enabled")).toBeVisible();
    } finally {
      // ALWAYS disable — never leave a shared dev account 2FA-gated after this spec runs.
      // The disable code is freshly computed from the SAME secret captured above (TOTP
      // activation never rotates the secret, only the enabled flag).
      const enabled = await page.getByTestId("two-factor-enabled").isVisible().catch(() => false);
      if (enabled && enrolledSecret) {
        const disableInput = page.getByTestId("two-factor-disable-code-input");
        if (await disableInput.isVisible().catch(() => false)) {
          await disableInput.fill(generateTotpCode(enrolledSecret));
          await page.getByTestId("two-factor-disable-button").click();
          await expect(page.getByTestId("two-factor-disabled")).toBeVisible({ timeout: 10_000 });
        }
      }
    }
  });
});
