/**
 * Site settings — sitewide marketing-website primitives (nav labels, footer columns/
 * legal links/copyright, SEO defaults, contact details, WhatsApp number) editable from
 * the CRM page builder (docs/specs/phase-10-page-builder.md item D). Read-only here;
 * admin CRUD lives in `apps/crm`.
 *
 * Caching: same `unstable_cache` (tagged, 5 min revalidate) pattern as `lib/nav-programs.ts`
 * — the fetch runs at revalidate time, not per request, and a thrown error propagates
 * OUT of `unstable_cache` (uncached) so a transient API failure isn't pinned for an hour.
 *
 * RESILIENCE (non-negotiable, docs/specs/phase-10-page-builder.md + this task's brief):
 * `getSiteSettings()` NEVER throws — a failed/unreachable API returns `null`, and every
 * caller in this file (and every consumer of it) falls back to the exact hardcoded
 * constant values that shipped before Phase-10, so the marketing site can never
 * white-screen (or render a broken/empty header/footer) because the CMS is down.
 */
import { unstable_cache } from "next/cache";
import type { PublicSiteSettingsResponse } from "@repo/types";
import { serverApiClient } from "./api-client";

async function fetchSiteSettings(): Promise<PublicSiteSettingsResponse> {
  // No try/catch here — see lib/nav-programs.ts's identical comment: a thrown error must
  // propagate out of unstable_cache so the failure itself is never cached.
  return serverApiClient.public.siteSettings.get();
}

const getCachedSiteSettings = unstable_cache(fetchSiteSettings, ["site-settings"], {
  // 5 min — matches the builder-editable pages' ISR window so a CRM settings edit and a
  // page edit surface on the same schedule (an editor saving both shouldn't see one lag 1 h).
  revalidate: 300,
  tags: ["site-settings"],
});

/** Public accessor: cached success, per-request retry on failure (never cached null). */
export async function getSiteSettings(): Promise<PublicSiteSettingsResponse | null> {
  try {
    return await getCachedSiteSettings();
  } catch {
    return null;
  }
}

/** `footer.copyright_text.template` carries a literal `{year}` placeholder — interpolate
 *  at render time (never bake in a year server-side) so it never goes stale. */
export function interpolateCopyrightTemplate(template: string, year: number): string {
  return template.replace("{year}", String(year));
}
