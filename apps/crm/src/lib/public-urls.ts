// Public (marketing-site) URLs the CRM links OUT to.
//
// The certificate verification page is served by the `web` app, NOT the CRM — a
// relative `/verify/<uid>` href resolved against the CRM's own origin (:3002),
// which has no such route, so "Verify" opened a blank page. Always build these
// against the web app's origin.
//
// Vite inlines `import.meta.env.VITE_*` at build time — never `process.env` in
// browser code.
const WEB_APP_URL = ((import.meta.env.VITE_WEB_APP_URL as string | undefined) ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

/** Public, unauthenticated certificate verification page (apps/web /verify/[certId]). */
export function certificateVerifyUrl(certUid: string): string {
  return `${WEB_APP_URL}/verify/${encodeURIComponent(certUid)}`;
}

// Phase-10 UI-polish (docs/specs/phase-10-ui-polish-ux-audit.md C2 "Web address" /
// PB-7): the 6 page-builder pages migrated onto their own dedicated `web` route files
// (apps/api/src/modules/content/content-pages-builder.constants.ts is the source of
// truth for this list — kept in lockstep with it) serve at their bare slug path; every
// other builder-managed page serves at the `/pages/[slug]` catch-all. `home` is the one
// slug with no path segment at all (root `apps/web/src/app/page.tsx`).
const MIGRATED_BUILDER_PAGE_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "scholarship",
  "for-colleges",
  "gallery",
  "careers",
]);

/** Path (no origin) a builder-managed page's `slug` actually serves at on `web`. */
export function publicPagePath(slug: string): string {
  if (slug === "home") return "/";
  if (MIGRATED_BUILDER_PAGE_SLUGS.has(slug.split("/")[0] ?? "")) return `/${slug}`;
  return `/pages/${slug}`;
}

/** Full absolute URL for a builder-managed page — used by "View live page" links. */
export function publicPageUrl(slug: string): string {
  return `${WEB_APP_URL}${publicPagePath(slug)}`;
}

/** Host + path, no protocol — e.g. "stimuliiq.com/about" — for display in tables/labels
 *  (docs/specs/phase-10-ui-polish-ux-audit.md C2: render the "slug" column as the full
 *  public URL). Falls back to the bare path if `VITE_WEB_APP_URL` is somehow unparsable. */
export function publicPageDisplayUrl(slug: string): string {
  try {
    return `${new URL(WEB_APP_URL).host}${publicPagePath(slug)}`;
  } catch {
    return publicPagePath(slug);
  }
}

/** Public campaign landing page (apps/web /lp/[slug]) — used by the "View live" link on
 *  the Landing Pages directory, per docs/specs/phase-10-ui-polish-ux-audit.md L1. */
export function landingPageUrl(slug: string): string {
  return `${WEB_APP_URL}/lp/${slug}`;
}
