// apps/api/src/modules/content/content-pages-builder.constants.ts
//
// Reserved-slug denylist for `POST /crm/content-pages/builder` (docs/specs/
// phase-10-page-builder.md Edge case #8: "a super_admin creates a page at slug
// `programs`, `blog`, or `verify`" — the existing `content.slug_taken` check only
// guards against colliding with another `ContentPage` row, never against a hardcoded
// `web` route file).
//
// Derived directly from `apps/web/src/app/*` — every top-level route folder that is
// NOT ContentPage-driven today. As of this writing NONE of the 6 page-builder
// migration targets (home/about/scholarship/for-colleges/gallery/careers,
// docs/specs/phase-10-page-builder.md Edge case #7) have been converted to a thin
// ContentPage-driven wrapper yet — that is a `frontend-builder` task tracked
// separately — so every one of those slugs is ALSO reserved for now: a builder page
// created at e.g. `/about` today would collide with the still-hardcoded
// `apps/web/src/app/about/page.tsx`, which knows nothing about `ContentPage`.
//
// MAINTENANCE: this list must be updated in lockstep with two kinds of `web` changes:
//   1. A new top-level route folder is added under `apps/web/src/app/*` — add its
//      slug here.
//   2. One of the 6 migration-target pages is converted to a ContentPage-driven
//      wrapper (frontend-builder) — remove its slug here once `web` actually reads
//      that slug from `ContentPage` (removing it before the migration lands would let
//      a super_admin create a page that collides with the still-hardcoded route).
//
// Snapshot (apps/web/src/app/* top-level folders, taken for this constant):
//   about, account, blog, book-free-slot, careers, contact, enroll, faculty, faq,
//   for-colleges, gallery, lp, mentors, partners, pay, pricing, privacy, programs,
//   refund-policy, scholarship, search, terms, testimonials, verify
export const RESERVED_BUILDER_SLUGS: ReadonlySet<string> = new Set<string>([
  "about",
  "account",
  "blog",
  "book-free-slot",
  "careers",
  "contact",
  "enroll",
  "faculty",
  "faq",
  "for-colleges",
  "gallery",
  // `lp` is the LandingPage model's catch-all route (`apps/web/src/app/lp/[slug]`) —
  // a DIFFERENT model from ContentPage; reserved so a builder page never shadows it.
  "lp",
  "mentors",
  "partners",
  "pay",
  "pricing",
  "privacy",
  "programs",
  "refund-policy",
  "scholarship",
  "search",
  "terms",
  "testimonials",
  "verify",
  // The homepage has no folder name (root `apps/web/src/app/page.tsx`). Reserved
  // defensively under the literal "home" even though `CreateBuilderPageRequestSchema`'s
  // slug regex requires length >= 1 (an empty-string slug can never reach this check).
  "home",
]);

/**
 * Checks a candidate builder slug against the denylist, matching on the FIRST path
 * segment (case-insensitive) — a nested page under a reserved top-level route (e.g.
 * `about/team`) is just as much a collision as the bare segment itself.
 */
export function isReservedBuilderSlug(slug: string): boolean {
  const firstSegment = slug.split("/")[0]?.toLowerCase() ?? "";
  return RESERVED_BUILDER_SLUGS.has(firstSegment);
}
