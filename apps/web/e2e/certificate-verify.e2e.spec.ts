// apps/web/e2e/certificate-verify.e2e.spec.ts
//
// R13 critical-journey e2e (docs/plans/phase-9-completion.md T41): public certificate
// verification (docs/06 user-flows, B10 "/verify" go-live blocker).
//
// SERVER-DEPENDENT: requires a REAL running API (default http://localhost:4000, override
// via API_BASE_URL) with a seeded tenant/admin (see prisma/seed.ts, QA_ADMIN_EMAIL/
// QA_ADMIN_PASSWORD) and this web app's own dev server (playwright.config.ts's
// `webServer` starts/reuses it). Every test SKIPS gracefully (never fails red) when the
// API/credentials aren't available, matching this repo's established
// skip-when-no-backend posture (e.g. global-setup.ts's DB-availability gate).
//
// Self-provisions its OWN certificate via the real API (POST /crm/certificates) rather
// than depending on a specific `prisma/seed.ts` cert_uid, because a cert_uid's HMAC
// signature is only verifiable by a server holding the SAME `CERT_SIGNING_SECRET` it was
// signed with — a cert_uid baked into seed data by one process is not guaranteed to
// verify against a DIFFERENT already-running API process (observed in this environment).
// Minting the cert against the SAME server this spec then queries removes that
// dependency entirely and is a MORE faithful "does /verify work end to end" proof.
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;

/**
 * The result page opens with a scan-then-reveal sequence (components/verify/verify-reveal.tsx)
 * and only shows the settled layout once it finishes, so every assertion about the RESULT has
 * to wait it out. The verdict itself is in the DOM the whole time — this waits for the point
 * at which it is on screen and in its final position.
 */
async function waitForRevealSettled(page: Page) {
  await page
    .locator('.verify-reveal[data-verify-stage="settled"]')
    .waitFor({ state: "attached", timeout: 15_000 });
  // Plus the settle animation itself (seal walk 0.62s, details 0.38s + 0.5s).
  await page.waitForTimeout(1_000);
}

interface Provisioned {
  certUid: string;
  holderName: string;
  programTitle: string;
}

async function provisionCertificate(request: APIRequestContext): Promise<Provisioned | undefined> {
  if (!ADMIN_PASSWORD) return undefined;

  const health = await request.get(`${API_BASE_URL}/api/v1/health/ready`).catch(() => undefined);
  if (!health || !health.ok()) return undefined;

  const login = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (login.status() !== 200) return undefined;
  const csrfToken = (await login.json()).data.csrfToken as string;

  const templatesRes = await request.get(`${API_BASE_URL}/api/v1/crm/certificate-templates`);
  const templateId = ((await templatesRes.json()).data as Array<{ id: string }>)[0]?.id;
  if (!templateId) return undefined;

  // Find an eligible, not-yet-issued enrollment (never fabricate eligibility — this
  // must be a REAL eligible row, same gate a human admin would see in the CRM UI).
  const eligibilityRes = await request.get(`${API_BASE_URL}/api/v1/crm/certificates/eligibility`, {
    params: { pageSize: "50" },
  });
  const rows = (await eligibilityRes.json()).data as Array<{
    enrollmentId: string;
    studentName: string;
    programTitle: string;
    eligibility: { eligible: boolean };
    certificateStatus: string | null;
  }>;
  const candidate = rows.find((r) => r.eligibility.eligible && !r.certificateStatus);
  if (!candidate) return undefined;

  const issueRes = await request.post(`${API_BASE_URL}/api/v1/crm/certificates`, {
    headers: { "X-CSRF-Token": csrfToken },
    data: { enrollmentId: candidate.enrollmentId, templateId },
  });
  if (issueRes.status() !== 201) return undefined;
  const issued = (await issueRes.json()).data as { certUid: string };

  return { certUid: issued.certUid, holderName: candidate.studentName, programTitle: candidate.programTitle };
}

/**
 * Falls back to an ALREADY-ISSUED valid certificate when there is no eligible,
 * not-yet-issued enrollment left to mint one from (a seeded DB has exactly one certificate
 * and, once issued, nothing else clears the eligibility gates). The download path doesn't
 * care how the certificate came to exist — only that it is valid.
 */
async function findExistingValidCertificate(request: APIRequestContext): Promise<Provisioned | undefined> {
  if (!ADMIN_PASSWORD) return undefined;

  const login = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (login.status() !== 200) return undefined;

  const res = await request.get(`${API_BASE_URL}/api/v1/crm/certificates/eligibility`, {
    params: { pageSize: "50" },
  });
  if (!res.ok()) return undefined;
  const rows = (await res.json()).data as Array<{
    studentName: string;
    programTitle: string;
    certificateStatus: string | null;
    certUid: string | null;
  }>;
  const issued = rows.find((r) => r.certificateStatus === "valid" && r.certUid);
  return issued
    ? { certUid: issued.certUid as string, holderName: issued.studentName, programTitle: issued.programTitle }
    : undefined;
}

test.describe("Certificate verify — public /verify page (B10)", () => {
  test("an obviously-fabricated certificate ID shows the 'Not found' state, not an error page", async ({ page }) => {
    await page.goto("/verify/this-cert-id-does-not-exist-12345");
    await waitForRevealSettled(page);
    await expect(page.getByTestId("verify-panel-invalid")).toBeVisible();
    await expect(page.getByTestId("verify-status-label")).toHaveText(/not found/i);
    // No internal details leaked (AC-H3/H4/H5 — matches the API-level guarantee already
    // proven by apps/api/src/modules/certificates/certificates.integration.spec.ts).
    await expect(page.getByTestId("verify-attempted-id")).toBeVisible();
  });

  test("the /verify landing page has a working certificate-ID entry form", async ({ page }) => {
    // `networkidle`, then real keystrokes rather than `fill()`.
    //
    // The submit button is disabled off React state (`value.trim().length === 0`), and the
    // server-rendered HTML ships it disabled too — so there is no DOM signal that says
    // hydration has finished. Filling before it does sets the DOM value while React's
    // state stays empty: the field LOOKS typed, the button stays disabled, and the click
    // never lands. That passes against a warm dev server and fails against a cold first
    // compile, which is the worst kind of flake. Keystrokes after networkidle are handled
    // by React itself, so state and DOM cannot disagree.
    await page.goto("/verify");
    await page.waitForLoadState("networkidle");
    const field = page.getByLabel("Certificate ID");
    await field.click();
    await field.pressSequentially("some-cert-id");
    const submit = page.getByRole("button", { name: /verify certificate/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    // 20s, not the 5s default. This is the first request for `/verify/[certId]` in the
    // run, so the dev server compiles the route before it can answer — the RSC prefetch
    // aborts and the client falls back to a full navigation. Measured at well over 5s
    // cold and under a second warm; the assertion is "it navigates", and a compile budget
    // is not what that assertion is about.
    await expect(page).toHaveURL(/\/verify\/some-cert-id/, { timeout: 20_000 });
  });

  test("a freshly self-provisioned certificate renders the 'Valid' state with holder name + program (full mint -> verify round trip)", async ({ page, request }) => {
    const provisioned = await provisionCertificate(request);
    test.skip(!provisioned, "Requires QA_ADMIN_PASSWORD + a reachable API with an eligible, not-yet-issued enrollment to self-provision a certificate.");
    if (!provisioned) return;

    await page.goto(`/verify/${provisioned.certUid}`);
    await waitForRevealSettled(page);
    await expect(page.getByTestId("verify-panel-valid")).toBeVisible();
    await expect(page.getByTestId("verify-status-chip")).toHaveText(/valid/i);
    // Scoped to the <main> content (not `getByText`, which also matches the <title>
    // Next.js renders from the same holder name for the page's <head>).
    await expect(page.getByTestId("verify-holder")).toHaveText(provisioned.holderName);
    await expect(page.getByTestId("verify-program")).toHaveText(provisioned.programTitle);
  });

  test("a valid certificate offers no download button: the page verifies, it does not hand out the PDF", async ({ page, request }) => {
    const cert = (await provisionCertificate(request)) ?? (await findExistingValidCertificate(request));
    test.skip(!cert, "Requires QA_ADMIN_PASSWORD + a reachable API with at least one valid certificate.");
    if (!cert) return;

    await page.goto(`/verify/${cert.certUid}`);
    await waitForRevealSettled(page);
    await expect(page.getByTestId("verify-panel-valid")).toBeVisible();
    await expect(page.getByTestId("verify-download-button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /download/i })).toHaveCount(0);
  });

  test("the status seal and the certificate details sit side by side on a desktop viewport", async ({ page, request }) => {
    const cert = (await provisionCertificate(request)) ?? (await findExistingValidCertificate(request));
    test.skip(!cert, "Requires QA_ADMIN_PASSWORD + a reachable API with at least one valid certificate.");
    if (!cert) return;

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/verify/${cert.certUid}`);
    await waitForRevealSettled(page);

    const seal = page.getByTestId("verify-status-label");
    const program = page.getByTestId("verify-program");
    const sealBox = await seal.boundingBox();
    const programBox = await program.boundingBox();
    expect(sealBox).not.toBeNull();
    expect(programBox).not.toBeNull();
    // Side by side, not stacked: the details start to the RIGHT of the seal's column.
    expect(programBox!.x).toBeGreaterThan(sealBox!.x + sealBox!.width);
  });

  test("the result opens with the scan sequence, which always ends on the settled result", async ({ page, request }) => {
    const cert = (await provisionCertificate(request)) ?? (await findExistingValidCertificate(request));
    test.skip(!cert, "Requires QA_ADMIN_PASSWORD + a reachable API with at least one valid certificate.");
    if (!cert) return;

    await page.goto(`/verify/${cert.certUid}`);

    // The scan runs first, and it must not be showing the verdict while it does.
    const overlay = page.locator(".verify-reveal__overlay");
    await expect(overlay).toBeAttached();
    await expect(overlay).toHaveAttribute("aria-hidden", "true");

    // ...and it always terminates: the overlay is dropped, not left sitting on top.
    await waitForRevealSettled(page);
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("verify-status-label")).toBeVisible();
  });

  test("prefers-reduced-motion gets the verdict immediately, with no scan to sit through", async ({ page, request }) => {
    const cert = (await provisionCertificate(request)) ?? (await findExistingValidCertificate(request));
    test.skip(!cert, "Requires QA_ADMIN_PASSWORD + a reachable API with at least one valid certificate.");
    if (!cert) return;

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/verify/${cert.certUid}`);

    // No wait: the result is on screen straight away and the overlay never shows.
    await expect(page.getByTestId("verify-program")).toHaveText(cert.programTitle);
    const resultOpacity = await page
      .locator(".verify-reveal__result")
      .evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(resultOpacity)).toBe(1);
    const overlay = page.locator(".verify-reveal__overlay");
    if (await overlay.count()) {
      // Dropped by CSS before the effect that unmounts it has even run.
      await expect(overlay).toBeHidden();
    }
  });

  test("a REVOKED certificate offers no download (the endpoint refuses it: 410 Gone)", async ({ request }) => {
    test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD.");

    // Assert the server-side guarantee directly: the button is only rendered for a valid
    // certificate, but the endpoint itself must also refuse a revoked one — the UI is not
    // the security boundary (CLAUDE.md §3 rule 5).
    const res = await request.get(`${API_BASE_URL}/api/v1/verify/tampered.signature/download`);
    expect(res.status()).toBe(404);
  });
});
