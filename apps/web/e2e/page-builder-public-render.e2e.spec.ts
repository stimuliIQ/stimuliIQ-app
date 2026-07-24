// apps/web/e2e/page-builder-public-render.e2e.spec.ts
//
// Page Builder — `web` fallback / public render. Originally Phase-10 (docs/specs/
// phase-10-page-builder.md AC 10, Edge case #7); Phase-11 locked templates
// (docs/plans/phase-11-locked-templates.md P5) REMOVED the `/pages/[...slug]` catch-all
// route + `RESERVED_SLUGS` machinery entirely ("no ad-hoc pages any more" — every core
// page is now a fixed, code-owned route). The two former tests here ("/pages/<unknown>
// 404s" and "/pages/about also 404s at the catch-all") asserted that REMOVED route's
// specific 404 behavior; they are deleted rather than kept, since `apps/web/src/app/pages`
// no longer exists — any `/pages/*` request now 404s via Next's default no-matching-route
// handling, which is not a meaningful assertion about this app's actual routing contract
// (any nonexistent path would 404 identically) and would misleadingly imply the
// catch-all/denylist still exists.
//
// Covers:
//   1. A migrated, seeded core-template page (`/gallery`) renders through the real
//      page-builder block registry (CMS content), not the pre-migration hardcoded
//      `*Fallback` component — proven via `data-testid="page-builder-hero"`, which only
//      the CMS-rendered path emits (the fallback renders a plain `<h1>` with no such
//      testid — see gallery-fallback.tsx), plus the seeded fixture's own hero headline.
//
// SERVER-DEPENDENT: needs the real API on :4000 (seeded DB — `pnpm db:seed`) and this
// app's own dev server (playwright.config.ts's `webServer` always boots a fresh instance
// on :3100). Read-only — creates no fixtures, needs no cleanup.
import { test, expect } from "@playwright/test";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";

test.describe("Page Builder (locked templates) — web public render", () => {
  test("a migrated seeded page (/gallery) renders CMS content via the block registry, not the hardcoded fallback", async ({
    page,
    request,
  }) => {
    const health = await request.get(`${API_BASE_URL}/api/v1/health/ready`).catch(() => undefined);
    test.skip(!health || !health.ok(), `API not reachable at ${API_BASE_URL}`);

    await page.goto("/gallery");

    const hero = page.getByTestId("page-builder-hero");
    await expect(hero).toBeVisible({ timeout: 15_000 });
    // The fixture's hero headline (prisma/fixtures/builder-pages/gallery.json) — proves
    // this render came from the ContentPage row, not a coincidentally-similar fallback.
    await expect(hero).toHaveAttribute("aria-label", "Gallery");

    // media_gallery block also renders through the registry (its own distinct testid —
    // the fallback's markup has no `page-builder-media-gallery` node at all).
    await expect(page.getByTestId("page-builder-media-gallery")).toBeVisible();
  });

  test("/pages/<any-slug> 404s — the ad-hoc page-builder catch-all route no longer exists", async ({ page }) => {
    const stamp = Date.now();
    const response = await page.goto(`/pages/definitely-not-a-real-page-${stamp}`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(404);
  });
});
