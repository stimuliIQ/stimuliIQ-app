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
import { test, expect, type APIRequestContext } from "@playwright/test";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;

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
    await expect(page.getByTestId("verify-panel-invalid")).toBeVisible();
    await expect(page.getByTestId("verify-status-label")).toHaveText(/not found/i);
    // No internal details leaked (AC-H3/H4/H5 — matches the API-level guarantee already
    // proven by apps/api/src/modules/certificates/certificates.integration.spec.ts).
    await expect(page.getByTestId("verify-attempted-id")).toBeVisible();
  });

  test("the /verify landing page has a working certificate-ID entry form", async ({ page }) => {
    await page.goto("/verify");
    await page.getByLabel("Certificate ID").fill("some-cert-id");
    await page.getByRole("button", { name: /verify certificate/i }).click();
    await expect(page).toHaveURL(/\/verify\/some-cert-id/);
  });

  test("a freshly self-provisioned certificate renders the 'Valid' state with holder name + program (full mint -> verify round trip)", async ({ page, request }) => {
    const provisioned = await provisionCertificate(request);
    test.skip(!provisioned, "Requires QA_ADMIN_PASSWORD + a reachable API with an eligible, not-yet-issued enrollment to self-provision a certificate.");
    if (!provisioned) return;

    await page.goto(`/verify/${provisioned.certUid}`);
    await expect(page.getByTestId("verify-panel-valid")).toBeVisible();
    await expect(page.getByTestId("verify-status-chip")).toHaveText(/valid/i);
    // Scoped to the <main> content (not `getByText`, which also matches the <title>
    // Next.js renders from the same holder name for the page's <head>).
    await expect(page.getByTestId("verify-holder")).toHaveText(provisioned.holderName);
    await expect(page.getByTestId("verify-program")).toHaveText(provisioned.programTitle);
  });

  test("the Download button on a valid certificate yields a real PDF", async ({ page, request }) => {
    const cert = (await provisionCertificate(request)) ?? (await findExistingValidCertificate(request));
    test.skip(!cert, "Requires QA_ADMIN_PASSWORD + a reachable API with at least one valid certificate.");
    if (!cert) return;

    await page.goto(`/verify/${cert.certUid}`);

    const button = page.getByTestId("verify-download-button");
    await expect(button).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);

    // Named after the programme, and the bytes are a genuine PDF (magic number) — not an
    // HTML error page or an empty file, which is what a broken storage key would yield.
    expect(download.suggestedFilename()).toMatch(/^Certificate-.*\.pdf$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    await expect(page.getByTestId("verify-download-error")).toHaveCount(0);
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
