/**
 * LMS auth gate — runs before any page HTML is produced.
 *
 * WHY THIS EXISTS (and why the client-side `SignedOutGate` wasn't enough):
 * `SignedOutGate` can only fire AFTER `GET /me` has round-tripped and come back 401,
 * because that's the first moment the browser knows the visitor is signed out. Until
 * then `LmsShell` has already painted the full authenticated chrome — side nav, tab
 * bar, search, account menu — so a signed-out visitor landing on `/` saw the entire
 * app skeleton (with a "You're signed out" card in the content well) before being
 * bounced. This middleware redirects that visitor at the edge, so they only ever
 * receive `/login`.
 *
 * The check is COOKIE PRESENCE, not token validity — middleware has no access to the
 * signing key and must not call the API on every navigation. That's deliberate and
 * sufficient as a first gate:
 *   - No cookie at all (a new/logged-out visitor, the reported case) -> redirected
 *     here, server-side, before a single byte of shell markup is sent.
 *   - Cookie present but expired/revoked -> passes this gate, then `/me` 401s and
 *     `SignedOutGate` redirects. `LmsShell` no longer paints its chrome until the
 *     session resolves, so no nav leaks in that window either.
 * Presence never grants access to data: every endpoint is still authorised server-side
 * by the API's guards (CLAUDE.md §3.5). This only decides which page to show.
 *
 * Cookie slot: the API writes an audience-scoped `lms_refresh_token` (see
 * apps/api/src/modules/auth/lib/cookies.ts) on `COOKIE_DOMAIN`, which is
 * `.stimuliiq.com` in production and `localhost` in dev — readable from this origin in
 * both. The legacy unprefixed `refresh_token` is accepted too so pre-slot sessions
 * aren't logged out by this change.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Routes a signed-out visitor must be able to reach. Everything else requires a session. */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/offline"];

/** Audience-scoped slot first, legacy unprefixed slot second. */
const SESSION_COOKIES = ["lms_refresh_token", "refresh_token"];

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value));
  if (hasSession) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  // Carry the attempted destination so login returns the student there afterwards —
  // same `?next=` contract the login page's safeNext() already validates. "/" is the
  // default target, so it's left off.
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next internals and any path with a file extension — the latter
  // covers the PWA's service worker, /manifest.webmanifest, icons and images, which
  // must stay reachable while signed out or the install/offline shell breaks.
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
