/**
 * app/sitemap.ts — dynamic XML sitemap for apps/web.
 *
 * Static routes + per-program entries from the public catalog (is_public + published).
 * Returns a Next.js MetadataRoute.Sitemap array (rendered as /sitemap.xml).
 *
 * AC-31: "valid XML sitemap containing at least one URL for each is_public=true,
 *          status=published program; Last-Modified date is recent."
 *
 * Strategy:
 *   - Static routes are listed with a fixed priority + monthly changeFrequency.
 *   - Programs are fetched via `client.public.programs.list()` (public API, no auth).
 *   - Errors fetching programs are silently caught so the sitemap still renders
 *     static routes (never a broken sitemap = empty Googlebot crawl).
 *   - ISR: Next.js caches this at build time and revalidates every 24h via
 *     `export const revalidate`.
 */
import type { MetadataRoute } from "next";
import { serverApiClient } from "../lib/api-client";
import { SITE_URL } from "../lib/seo/metadata";

export const revalidate = 86_400; // 24 hours

// ---------------------------------------------------------------------------
// Static routes
// ---------------------------------------------------------------------------

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  {
    url: `${SITE_URL}/`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 1.0,
  },
  {
    url: `${SITE_URL}/programs`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 0.9,
  },
  {
    url: `${SITE_URL}/pricing`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    url: `${SITE_URL}/about`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    url: `${SITE_URL}/testimonials`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.6,
  },
  // `/partners` was listed here but no such route exists: it returns 404 on the live site.
  // A sitemap is a set of assertions that these URLs are worth crawling, so a 404 in it spends
  // crawl budget to earn an error and lowers trust in the rest of the file. Removed rather than
  // stubbed, because the partner logos already render inside /about and /for-colleges.
  {
    url: `${SITE_URL}/scholarship`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    url: `${SITE_URL}/mentors`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.7,
  },
  {
    url: `${SITE_URL}/gallery`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    url: `${SITE_URL}/blog`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: `${SITE_URL}/faq`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    url: `${SITE_URL}/careers`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.6,
  },
  {
    url: `${SITE_URL}/contact`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    url: `${SITE_URL}/for-colleges`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    url: `${SITE_URL}/verify`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.4,
  },
];

// City SEO pages and landing pages are ad/campaign or long-tail SEO surfaces
// fetched below (dynamic) rather than hardcoded here.

// ---------------------------------------------------------------------------
// Sitemap generator
// ---------------------------------------------------------------------------

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fetch public programs for dynamic entries.
  // Silently catch all errors — the static routes must still be returned.
  let programRoutes: MetadataRoute.Sitemap = [];

  try {
    // Paginate through all public programs (the API caps limit at 50, so loop
    // with the cursor — bounded to a few pages to stay well within sitemap size).
    const slugs: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 8; page += 1) {
      const result = await serverApiClient.public.programs.list({ limit: 50, ...(cursor ? { cursor } : {}) });
      slugs.push(...result.items.map((program) => program.slug));
      if (!result.meta?.hasMore || !result.meta?.nextCursor) break;
      cursor = result.meta.nextCursor;
    }

    programRoutes = slugs.map((slug) => ({
      url: `${SITE_URL}/programs/${encodeURIComponent(slug)}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.85,
    }));
  } catch {
    // API unavailable at build time — sitemap renders with static routes only.
    // This is acceptable; Googlebot will re-crawl on the next revalidation.
  }

  // Per-city SEO pages (T33: docs/plans/phase-9-completion.md) — one entry per
  // city returned by the public SEO surface. Same silent-catch policy as above.
  let cityRoutes: MetadataRoute.Sitemap = [];

  try {
    const { cities } = await serverApiClient.public.seo.listCities();
    cityRoutes = cities.map((city) => ({
      url: `${SITE_URL}/programs/city/${encodeURIComponent(city.citySlug)}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  } catch {
    // API unavailable at build time — sitemap renders without city pages.
  }

  // Campaign landing pages (`/lp/[slug]`) are intentionally excluded — they are
  // ad-traffic pages, not organic-search targets (see robots.ts, same treatment
  // as /book-free-slot).

  // Phase-11 locked templates (docs/plans/phase-11-locked-templates.md): the free-form
  // `/pages/<slug>` builder catch-all (Phase-10) is removed — every marketing page is now
  // one of the 6 fixed, code-owned routes above (already covered by `STATIC_ROUTES`), so
  // there is no longer a class of CMS-created pages this sitemap can't enumerate.

  return [...STATIC_ROUTES, ...programRoutes, ...cityRoutes];
}
