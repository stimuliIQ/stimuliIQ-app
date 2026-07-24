// apps/crm/e2e/page-builder-site-settings.e2e.spec.ts
//
// Phase-10 Page Builder + Site Settings — critical-journey e2e (docs/specs/
// phase-10-page-builder.md AC 1/5/6/7/8/9, "Site Settings").
//
// Covers:
//   1. super_admin: Page Builder -> open the seeded `about` page (its seeded
//      `live_collection_ref(testimonials)` block never sets `selection.minRating` — this is
//      the exact shape that used to permanently disable Save, see "D1" below) -> Save becomes
//      enabled -> edit the hero headline -> Save (confirm dialog) -> the change is served by
//      GET /public/pages/:slug on the very next request (AC 1/5). Version history shows the
//      new version (AC 6); that version's Revert button is enabled immediately (see "D2"
//      below); reverting restores the prior headline and is itself a new, append-only version
//      entry (AC 7).
//   2. A non-super_admin CRM staff role (marketing, which already holds the broader
//      content.edit/content.publish grants) does NOT see Page Builder/Site Settings in the
//      nav, is shown a forbidden state if it navigates there directly, and is 403'd calling
//      a builder mutation endpoint directly (AC 8/9).
//   3. super_admin: Site Settings -> Footer tab -> edit the copyright template -> Save ->
//      GET /public/site-settings reflects it (restored in `finally`).
//
// FIXED DEFECTS (previously flagged here, now regression-guarded by this spec):
//   D1 — `about`/`home`'s seeded `live_collection_ref(testimonials, mode=filter)` block never
//   sets `selection.minRating`; react-hook-form's `register(..., { valueAsNumber: true })`
//   turns that untouched `type="number"` input into the NUMBER `NaN` (per the DOM spec,
//   `input.valueAsNumber` is `NaN` when empty, not `0`), which zod's `.optional()` does NOT
//   treat as absent (only `undefined` is). Fixed in `apps/crm/src/lib/clean-empty-strings.ts`
//   by also normalizing `NaN` -> `undefined` (previously only empty STRINGS were normalized) —
//   applied uniformly to every numeric field across all 11 block forms via block-card.tsx's
//   resolver/`getValues()` wrapper, not just `minRating`. This spec now opens `about`
//   specifically (previously avoided in favor of `for-colleges`) and asserts Save becomes
//   enabled without ever touching that field.
//   D2 — `version-history-panel.tsx` used to disable a version's Revert button (and badge it
//   "Current") whenever `version.version === currentVersion`. Save-before-apply semantics mean
//   NO version snapshot ever equals the live page (a version row is always "what it looked
//   like right BEFORE some save") — so the newest row was always wrongly disabled, blocking
//   the single most common case: undo my last edit. Fixed by removing the disabled condition
//   entirely (every version is always revertible) and relabeling the newest row "Before last
//   save" (by list position, never by comparing to `currentVersion`). This spec now asserts
//   the newest version's Revert button is enabled immediately after one save, instead of
//   requiring a second save to "age it out" of the old (wrong) disabled state.
//
// Why assert via the API rather than re-rendering `web`: `web`'s migrated pages fetch
// through `serverApiClient` with no explicit `cache`/`next.revalidate` option on 5 of the 6
// routes (about/scholarship/for-colleges/gallery/careers) — only the homepage sets
// `export const revalidate = 3600`. Under Next.js 15's request-time rendering this is
// expected to be fresh per request in `next dev` (which never applies production ISR), but
// asserting the API response directly is deterministic regardless of `web`'s caching mode
// and avoids coupling this spec to a second app's dev server. `apps/web/e2e/
// page-builder-public-render.e2e.spec.ts` covers the actual `web` render + the `/pages/
// unknown-slug` 404 fallback.
//
// SERVER-DEPENDENT: needs a running API (:4000) + this app's dev server + a real super_admin
// account (QA_ADMIN_PASSWORD). `beforeAll` activates a known, documented password for the
// seeded `marketing.rahul@stimuliiq.test` fixture (seed-data users otherwise get a
// non-loginable placeholder hash — see prisma/seed.ts `ensureSeedUser` — the login DTO's
// PasswordSchema requires a digit, which the deterministic `seed-<email>` placeholder never
// has), mirroring `scripts/dev-set-passwords.cjs`'s exact pattern/guard for the other 5 demo
// accounts. Local-DB-only by construction (refuses a non-localhost DATABASE_URL).
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "admin@stimuliiq.test";
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;
const MARKETING_EMAIL = "marketing.rahul@stimuliiq.test";
const MARKETING_PASSWORD = "Marketing@12345";
const API_BASE_URL = process.env.VITE_API_URL ?? "http://localhost:4000";

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByTestId("login-card").getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("login-card")).not.toBeVisible({ timeout: 15_000 });
}

async function csrfToken(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "crm_csrf_token");
  expect(cookie?.value, "crm_csrf_token cookie must be set after login").toBeTruthy();
  return cookie!.value;
}

/**
 * Activates a known, non-secret local-dev password for the seeded marketing fixture user —
 * same pattern/guard as `scripts/dev-set-passwords.cjs` (that script's own ACCOUNTS list
 * does not include this user). Talks to Postgres directly via `@prisma/client` (a root
 * workspace dependency, resolvable from here) — no HTTP surface exists to set another
 * user's password (by design: no admin-triggered password-reset feature exists yet, see
 * `docs/plans/phase-9-completion.md` password-reset follow-up).
 */
async function ensureMarketingLoginReady(): Promise<void> {
  // Dynamic import (not a static one) — @prisma/client/argon2 are root workspace deps, not
  // this app's own dependencies; a static import would fail this app's own type-check.
  const { PrismaClient } = await import("@prisma/client");
  const argon2 = await import("argon2");

  const dbUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55433/stimuliiq";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
    throw new Error(`[page-builder e2e] refusing to set a password against a non-local DATABASE_URL: ${dbUrl}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const tenant = await prisma.tenant.findFirst({ where: { slug: "stimuliiq" } });
    if (!tenant) throw new Error("Tenant 'stimuliiq' not found — run `pnpm db:seed` first.");
    const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: MARKETING_EMAIL } });
    if (!user) throw new Error(`${MARKETING_EMAIL} not found — run \`pnpm db:seed\` first.`);
    const passwordHash = await argon2.hash(MARKETING_PASSWORD, { type: argon2.argon2id });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, status: "active" } });
  } finally {
    await prisma.$disconnect();
  }
}

test.describe("Phase-10 Page Builder + Site Settings", () => {
  test.skip(!ADMIN_PASSWORD, "Requires QA_ADMIN_PASSWORD env var.");

  test.beforeAll(async () => {
    await ensureMarketingLoginReady();
  });

  test("super_admin edits the About Us hero headline, saves live, and can revert via version history", async ({
    page,
    request,
  }) => {
    // Generous, explicit timeout rather than test.slow()'s 3x multiplier — a COLD Vite dev
    // server compiling the page-builder editor's route + its dependency graph on-demand for
    // the first navigation in a run has been observed to exceed even a 90s budget on this
    // machine; every other test in this file (which shares one warm dev-server instance
    // across the whole file) comfortably finishes in under 10s.
    test.setTimeout(180_000);
    const stamp = Date.now();

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD!);

    await page.goto("/marketing/page-builder");
    await expect(page.getByTestId("page-builder-list")).toBeVisible({ timeout: 15_000 });
    // "about", specifically — its seeded `live_collection_ref(testimonials)` block never sets
    // `selection.minRating`. This is the exact D1 regression case: Save must become enabled
    // WITHOUT ever touching that field (see file header "FIXED DEFECTS — D1").
    await page.getByTestId("page-builder-list-search").fill("about");
    // Click the title cell specifically — the row also contains a "View live" external
    // link (target="_blank", stops propagation so it never double-fires the row's open
    // action); clicking the literal row center could otherwise land on that link.
    await page.getByRole("row", { name: /About Us/i }).getByText("About Us", { exact: true }).click();
    await expect(page.getByTestId("page-builder-editor")).toBeVisible({ timeout: 15_000 });
    // D1 regression guard: this used to stay permanently disabled for `about`/`home`.
    await expect(page.getByTestId("page-builder-save-button")).toBeEnabled({ timeout: 10_000 });

    // Phase-10 UI-polish: sections collapse by default (docs/specs/
    // phase-10-ui-polish-visual-audit.md §2.1/§2.3) — expand the Hero section's card before
    // touching its fields. Phase-11 locked templates renamed the per-block card testid to
    // `page-builder-section-card-*` (template-section-card.tsx) when the free block-builder's
    // `block-card.tsx` was deleted.
    await page
      .locator('[data-testid^="page-builder-section-card-"]')
      .filter({ hasText: "Hero" })
      .getByTestId("collapsible-section-trigger")
      .first()
      .click();

    const headlineInput = page.getByTestId("hero-headline");
    await expect(headlineInput).toBeVisible();
    const originalHeadline = await headlineInput.inputValue();
    expect(originalHeadline.length).toBeGreaterThan(0);

    async function publicHeadline(): Promise<string | undefined> {
      const res = await request.get(`${API_BASE_URL}/api/v1/public/pages/about`);
      const body = (await res.json()) as { data: { body: Array<{ type: string; data: { headline?: string } }> } };
      return body.data.body[0]?.data.headline;
    }

    async function saveHeadline(value: string): Promise<void> {
      await headlineInput.fill(value);
      await page.getByTestId("page-builder-save-button").click();
      await expect(page.getByTestId("confirm-save-page-builder-page")).toBeVisible();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(page.getByTestId("confirm-save-page-builder-page")).not.toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("toast").filter({ hasText: /Saved/i })).toBeVisible({ timeout: 10_000 });
    }

    // Version numbers are NOT assumed to start at 0/1 — this page may already carry history
    // from an earlier run (version history is permanent/append-only by design, so a prior
    // partial run's saves are still there). Read the current highest version first.
    await page.getByTestId("page-builder-open-history").click();
    await expect(page.getByTestId("page-builder-version-history-panel")).toBeVisible();
    // 0 when the empty state renders (no version rows match the locator either way).
    const baseVersion = await page.locator('[data-testid^="page-builder-version-row-"]').count();
    await page.getByRole("button", { name: /close panel/i }).click();
    await expect(page.getByTestId("page-builder-version-history-panel")).not.toBeVisible({ timeout: 5_000 });

    // Append (never replace) so the existing `headlineHighlight` — validated as a substring
    // of `headline` — stays valid without also having to touch that field.
    const editedOnce = `${originalHeadline} [qa-e2e-${stamp}-a]`;
    await saveHeadline(editedOnce);

    // AC 1/5 — save is live: the public read reflects the new headline on the very next
    // request, no separate publish step.
    await expect.poll(publicHeadline, { timeout: 10_000 }).toBe(editedOnce);

    // AC 6 — version history: a new version (baseVersion+1) now exists. Its snapshot holds
    // the ORIGINAL (pre-this-save) headline — save-before-apply semantics (pages.schemas.ts /
    // content-page-versions.repository.ts header) — so v1 is exactly "before my last save."
    const v1 = baseVersion + 1;
    await page.getByTestId("page-builder-open-history").click();
    await expect(page.getByTestId("page-builder-version-history-panel")).toBeVisible();
    const v1Row = page.getByTestId(`page-builder-version-row-${v1}`);
    await expect(v1Row).toBeVisible({ timeout: 10_000 });

    // D2 regression guard: the newest version's Revert button must be enabled immediately —
    // no second save required to "age it out" of a wrongly-disabled "current" state (there is
    // no such state; see file header "FIXED DEFECTS — D2"). It's labelled by list position,
    // not compared against `currentVersion`.
    await expect(v1Row).toContainText("Before last save");
    const revertButton = page.getByTestId(`page-builder-version-revert-${v1}`);
    await expect(revertButton).toBeEnabled();

    // AC 7 — revert: reverting v1 restores the original headline live and is itself appended
    // as a new version (history is append-only, never rewound/deleted).
    await v1Row.getByRole("button", { name: /^View$/ }).click();
    await expect(v1Row).toContainText("About Us");
    await revertButton.click();
    await expect(page.getByTestId("confirm-revert-page-version")).toBeVisible();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId("confirm-revert-page-version")).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("toast").filter({ hasText: /Reverted/i })).toBeVisible({ timeout: 10_000 });

    await expect.poll(publicHeadline, { timeout: 10_000 }).toBe(originalHeadline);

    // Append-only: the "edit" version AND the "revert" version both remain listed (history is
    // never rewound/deleted) — baseVersion + 2 rows total. The panel is still open from the
    // revert step above (a successful revert does not auto-close it).
    const rows = page.locator('[data-testid^="page-builder-version-row-"]');
    await expect(rows).toHaveCount(baseVersion + 2, { timeout: 10_000 });
  });

  test("a non-super_admin (marketing) cannot see or use the page builder / site settings", async ({ page }) => {
    await login(page, MARKETING_EMAIL, MARKETING_PASSWORD);

    // UI: the nav never renders the leaves (AC 8's "no page/block data is ever fetched"
    // precondition — a hidden leaf can't be navigated to by clicking). Page Builder /
    // Site Settings live under the "Website" section (IA regrouping — routes unchanged).
    await page.getByTestId("nav-section-website").click();
    await expect(page.getByTestId("nav-leaf-page-builder")).toHaveCount(0);
    await expect(page.getByTestId("nav-leaf-site-settings")).toHaveCount(0);
    // Sanity: a grant marketing DOES hold is visible in the same section, proving the
    // absence above is a deliberate permission gate, not a broken nav render.
    await expect(page.getByTestId("nav-leaf-blog-cms")).toBeVisible();

    // UI: direct navigation is also gated — forbidden state, no data fetched (AC 8).
    await page.goto("/marketing/page-builder");
    await expect(page.getByTestId("page-builder-page-access-denied")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("page-builder-list")).toHaveCount(0);

    await page.goto("/marketing/site-settings");
    await expect(page.getByTestId("site-settings-page-access-denied")).toBeVisible({ timeout: 10_000 });

    // API: a direct call to a builder mutation endpoint 403s even though this role holds
    // the broader content.edit/content.publish grants (AC 9). PermissionsGuard runs before
    // the validation pipe, so an intentionally-empty body still proves the permission gate.
    const csrf = await csrfToken(page);
    const res = await page.request.post(`${API_BASE_URL}/api/v1/crm/content-pages/builder`, {
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      data: {},
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toMatch(/permission|forbidden/i);
  });

  test("super_admin edits the footer copyright text; public/site-settings reflects it", async ({ page, request }) => {
    const stamp = Date.now();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD!);

    await page.goto("/marketing/site-settings");
    await expect(page.getByTestId("site-settings-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("site-settings-tab-footer").click();
    await expect(page.getByTestId("site-setting-footer-copyright")).toBeVisible({ timeout: 10_000 });

    const templateInput = page.getByTestId("footer-copyright-template");
    const originalTemplate = await templateInput.inputValue();
    const editedTemplate = `© {year} StimuliiQ QA ${stamp}. All rights reserved.`;

    try {
      await templateInput.fill(editedTemplate);
      await page.getByTestId("site-setting-footer-copyright-save").click();
      await expect(page.getByTestId("toast").filter({ hasText: /Saved/i })).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(
          async () => {
            const res = await request.get(`${API_BASE_URL}/api/v1/public/site-settings`);
            const body = (await res.json()) as { data: Record<string, { template?: string }> };
            return body.data["footer.copyright_text"]?.template;
          },
          { timeout: 10_000 },
        )
        .toBe(editedTemplate);
    } finally {
      // Restore — site settings are a single shared sitewide row, not a per-run fixture.
      await templateInput.fill(originalTemplate);
      await page.getByTestId("site-setting-footer-copyright-save").click();
      await expect(page.getByTestId("toast").filter({ hasText: /Saved/i })).toBeVisible({ timeout: 10_000 });
    }
  });
});
