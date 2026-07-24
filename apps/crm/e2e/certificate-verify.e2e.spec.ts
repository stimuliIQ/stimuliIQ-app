// apps/crm/e2e/certificate-verify.e2e.spec.ts
//
// Certificates page regressions:
//
//   1. VERIFY WENT NOWHERE. The link was a RELATIVE `/verify/<uid>` href, so it resolved
//      against the CRM's own origin (:3002) — which has no such route. The verification
//      page is served by the PUBLIC web app (:3000). Now built from VITE_WEB_APP_URL.
//
//   2. …and even at the right URL it 404'd, because the SEEDED certificate carried an
//      unsigned placeholder cert_uid. /verify recomputes an HMAC over the uid and rejects
//      anything unsigned, so the demo certificate could never verify. prisma/seed.ts now
//      mints a properly signed uid (and re-signs a legacy unsigned one in place).
//
// Read-only against seeded data. Requires the WEB app on :3000 as well as the API + CRM.
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#login-email").fill(ADMIN_EMAIL);
  await page.locator("#login-password").fill(ADMIN_PASSWORD!);
  await page.getByTestId("login-card").getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("login-card")).not.toBeVisible({ timeout: 15_000 });
}

test.describe("Certificates — public verify link", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD env var.");

  test("Verify points at the PUBLIC web app and the seeded certificate actually verifies", async ({
    page,
    context,
  }) => {
    await login(page);
    await page.goto("/content/certificates");

    // Search for the seeded certificate holder first — enrollments created by
    // concurrently/previously running specs can push the single ISSUED row off
    // page 1, and only issued rows render a verify link.
    await page.getByTestId("certificates-search-input").fill("Sneha");
    const verify = page.locator('[data-testid^="verify-link-"]').first();
    await expect(verify).toBeVisible({ timeout: 15_000 });

    // Absolute, and NOT on the CRM's own origin — that was the bug.
    const href = await verify.getAttribute("href");
    expect(href).toMatch(/^https?:\/\//);
    expect(href).not.toContain(":3002");
    // A signed uid is `<base64url payload>.<base64url sig>` — an unsigned stub can't verify.
    expect(href).toMatch(/\/verify\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const [publicPage] = await Promise.all([context.waitForEvent("page"), verify.click()]);
    await publicPage.waitForLoadState("domcontentloaded");

    await expect(publicPage.getByText("Certificate Verified")).toBeVisible({ timeout: 20_000 });
    // .first(): the programme name also appears in the page's JSON-LD SEO block, so a
    // bare getByText would strict-mode-violate on two matches.
    await expect(publicPage.getByText("Data Science & Machine Learning Internship").first()).toBeVisible();
    await expect(publicPage.getByText("Sneha Iyer").first()).toBeVisible();
    await expect(publicPage.getByText(/Certificate Not Found/i)).toHaveCount(0);
  });

  test("status chips stay on one line and the row actions do not wrap", async ({ page }) => {
    await login(page);
    await page.goto("/content/certificates");

    // "Not eligible" is the longest chip label and used to break across two lines,
    // inflating the row. One text line ⇒ chip height stays within a single line box.
    const chip = page.getByText("Not eligible").first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    const box = (await chip.boundingBox())!;
    expect(box.height).toBeLessThan(28);

    // Revoke + Verify sit side by side on the issued row, not stacked. Search for
    // the seeded ISSUED row first — other specs' enrollments can push it off page 1.
    await page.getByTestId("certificates-search-input").fill("Sneha");
    const revoke = page.locator('[data-testid^="revoke-button-"]').first();
    const verify = page.locator('[data-testid^="verify-link-"]').first();
    const revokeBox = (await revoke.boundingBox())!;
    const verifyBox = (await verify.boundingBox())!;
    expect(Math.abs(revokeBox.y - verifyBox.y)).toBeLessThan(12);
  });
});
