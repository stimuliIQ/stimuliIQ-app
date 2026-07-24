/**
 * Course facets — distinct specialisation (domain) values from the live public
 * catalog, for the /programs sidebar filter. Same data source and caching
 * strategy as nav-programs.ts: exactly the CRM-published courses, cached 1 h
 * under the "nav-programs" tag so a future publish-hook revalidates both.
 *
 * Failure mode: returns [] on API error/empty catalog — the sidebar then only
 * shows "All Courses" instead of an empty checkbox list.
 *
 * Coverage note: reads one max-size page (50). If the catalog ever exceeds 50
 * published courses, domains present only beyond the first page won't facet —
 * acceptable for a filter teaser; a dedicated facets endpoint can replace this.
 */
import { unstable_cache } from "next/cache";

import { serverApiClient } from "./api-client";
import { humanizeDomain } from "./format";

export interface CourseDomainFacet {
  /** Raw domain value as stored on the course (used in the ?domain= param). */
  value: string;
  /** Human-readable label for the checkbox. */
  label: string;
}

async function fetchCourseDomains(): Promise<CourseDomainFacet[]> {
  try {
    const result = await serverApiClient.public.programs.list({
      limit: 50,
      sort: "popularity",
    });
    const items = Array.isArray(result.items) ? result.items : [];
    const byValue = new Map<string, string>();
    for (const program of items) {
      if (program.domain && !byValue.has(program.domain)) {
        byValue.set(program.domain, humanizeDomain(program.domain));
      }
    }
    return [...byValue.entries()].map(([value, label]) => ({ value, label }));
  } catch {
    return [];
  }
}

export const getCourseDomains = unstable_cache(fetchCourseDomains, ["course-domains"], {
  revalidate: 3600,
  tags: ["nav-programs"],
});
