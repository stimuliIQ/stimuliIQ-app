/**
 * Dynamic Programs navigation — mega-menu sections + footer links built from
 * the live public catalog (GET /public/programs), which surfaces exactly the
 * courses the CRM has published (status=published AND is_public=true).
 *
 * Server-only: called from the root layout (RSC) and passed down to SiteShell.
 *
 * Caching: wrapped in unstable_cache (1 h revalidate, "nav-programs" tag) so
 *   - static/ISR marketing pages stay static (the fetch runs at revalidate
 *     time, not per request), and
 *   - the API sees at most ~1 catalog read per hour for nav purposes.
 *
 * Failure mode: returns null on API error or an empty catalog — callers fall
 * back to the static nav config so the header never renders an empty menu.
 */
import { unstable_cache } from "next/cache";

import { serverApiClient } from "./api-client";
import { humanizeDomain } from "./format";
import type { PublicProgramSummary } from "@repo/types";
import type { MegaMenuSection } from "@repo/ui";

/** Max mega-menu columns (matches the 4-column desktop layout). */
const MAX_SECTIONS = 4;
/** Max programs listed per column — the menu is a teaser, not the catalog. */
const MAX_ITEMS_PER_SECTION = 5;
/**
 * Catalog fetch size. MUST respect ListPublicProgramsQuerySchema's `limit` cap
 * of 50 — the previous value (100) made EVERY nav fetch 400 ("Number must be
 * less than or equal to 50"), so the header silently rendered the hardcoded
 * fallback catalog (fake courses with dead links) instead of the live programs.
 * The menu shows at most 4×5 items, so 50 is more than enough.
 */
const FETCH_LIMIT = 50;

export interface ProgramsNav {
  megaMenuSections: MegaMenuSection[];
  /** Footer "Programs" column links (top programs + view-all). */
  footerLinks: Array<{ label: string; href: string }>;
}

async function fetchProgramsNav(): Promise<ProgramsNav | null> {
  // No try/catch here: a thrown error must PROPAGATE out of unstable_cache so
  // the failure is NOT cached — previously a single failed fetch pinned the
  // static fallback nav for a full hour. getProgramsNav() catches per-request.
  const result = await serverApiClient.public.programs.list({
    limit: FETCH_LIMIT,
    sort: "popularity",
  });
  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) return null;

    // Group by domain, preserving popularity order within and across groups.
    const byDomain = new Map<string, PublicProgramSummary[]>();
    for (const program of items) {
      const key = program.domain || "programs";
      const group = byDomain.get(key);
      if (group) {
        group.push(program);
      } else {
        byDomain.set(key, [program]);
      }
    }

    // Domains in first-seen order. `items` is popularity-sorted and Map preserves
    // insertion order, so the columns are the domains of the MOST POPULAR programs —
    // a size-first sort (previous behavior) arbitrarily dropped popular programs
    // whenever many domains had only one or two courses each.
    const sections: MegaMenuSection[] = [...byDomain.entries()]
      .slice(0, MAX_SECTIONS)
      .map(([domain, programs]) => ({
        heading: humanizeDomain(domain),
        // No description line: the menu shows the course title only (mode/duration
        // were removed 2026-07-31 — the "Hybrid · 4 weeks" subline).
        items: programs.slice(0, MAX_ITEMS_PER_SECTION).map((program) => ({
          label: program.title,
          href: `/programs/${program.slug}`,
        })),
      }));

  const footerLinks = [
    ...items.slice(0, 5).map((program) => ({
      label: program.title,
      href: `/programs/${program.slug}`,
    })),
    { label: "View All Programs", href: "/programs" },
  ];

  return { megaMenuSections: sections, footerLinks };
}

/**
 * Cached fetch — revalidates hourly; tag "nav-programs" allows on-demand
 * revalidation (revalidateTag) if a publish-hook is added later. Errors
 * propagate (uncached) — see fetchProgramsNav.
 */
const getCachedProgramsNav = unstable_cache(fetchProgramsNav, ["nav-programs"], {
  revalidate: 3600,
  tags: ["nav-programs"],
});

/**
 * Public accessor: cached success, per-request retry on failure. Returns null
 * only when the API is unreachable (callers fall back to the static config) or
 * the catalog is genuinely empty.
 */
export async function getProgramsNav(): Promise<ProgramsNav | null> {
  try {
    return await getCachedProgramsNav();
  } catch {
    // API unreachable — caller falls back to the static nav config. NOT cached,
    // so the very next request retries the live catalog.
    return null;
  }
}
