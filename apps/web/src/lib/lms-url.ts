// apps/web/src/lib/lms-url.ts
//
// Where the marketing site sends someone who needs to sign in.
//
// `apps/web` has no login form of its own — students sign in to the LMS, staff to the
// CRM. The two places that offered a "Sign in" / "Log in" affordance pointed at
// `/enroll` (a route that does not exist; `app/enroll/` contains only `[slug]/`, so it
// was a hard 404) and at `/account` itself, which is the page showing the signed-out
// state — a link back to where the visitor already is.
//
// Mirrors `lib/seo/metadata.ts`'s handling of NEXT_PUBLIC_SITE_URL: read at build time
// with a production default, so a deployment that forgets the var still lands somewhere
// real rather than on a 404.

const DEFAULT_LMS_ORIGIN = "https://learn.stimuliiq.com";

/** The LMS origin, without a trailing slash. */
export const LMS_ORIGIN: string = (
  process.env.NEXT_PUBLIC_LMS_URL ?? DEFAULT_LMS_ORIGIN
).replace(/\/+$/, "");

/**
 * The LMS sign-in page.
 *
 * @param next Optional path within the LMS to return to after signing in.
 */
export function lmsLoginUrl(next?: string): string {
  const base = `${LMS_ORIGIN}/login`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}
