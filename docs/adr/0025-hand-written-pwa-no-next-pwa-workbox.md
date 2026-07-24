# ADR 0025: Hand-written PWA (no next-pwa / Workbox)

## Status
Accepted

## Context
`docs/02-prd-lms.md` and `docs/plans/phase-3.md` require the LMS to be installable as
a PWA (Progressive Web App) so students on low-bandwidth mobile connections can install
it to their home screen and use it offline for navigation (offline video is explicitly
out of scope — see below).

The two dominant PWA tooling options for a Next.js App Router app are:

1. **`next-pwa`**: a popular wrapper around Workbox that generates a `sw.js` and
   `manifest.json` from Next.js build output. However, `next-pwa` was not actively
   maintained for Next.js 13+ App Router at the time of P3 implementation, and its
   Workbox precache configuration needs careful tuning to avoid caching signed video
   URLs or API responses — categories that must never be cached.
2. **Workbox (direct)**: more control, but adds a significant dependency (multiple
   Workbox packages) and requires a build plugin or a manual import. Still a
   dependency-approval question.
3. **Hand-written `sw.js`**: a minimal service worker written directly in vanilla JS,
   registered only in production. No new npm dependency. Full control over what is and
   is not cached.

The LMS has a non-negotiable constraint: **signed short-TTL per-user HLS URLs (ADR-0021)
must never be cached or persisted by the service worker.** A misconfigured Workbox
precache or runtime cache that happens to capture a signed `.m3u8` URL would silently
serve stale or another-user's URL to subsequent requests.

## Decision
The PWA is implemented without `next-pwa` or Workbox:

- **`app/manifest.ts`**: Next.js App Router's built-in `MetadataRoute.Manifest` export
  generates `manifest.webmanifest` at `GET /manifest.webmanifest`. No static file needed.
- **`public/sw.js`**: a hand-written vanilla JS service worker with three cache strategies:
  1. **Navigation (HTML) requests**: network-first; falls back to `/offline` page on
     failure. Ensures students see a useful offline page rather than a browser error.
  2. **Immutable static assets** (`/_next/static/`): cache-first with a versioned cache
     name derived from the Next.js build ID. Safe to cache indefinitely because Next.js
     content-hashes these paths.
  3. **Everything else**: network-only (no caching). This covers:
     - All cross-origin requests (CDN signed video segments, provider manifests).
     - All `api/` requests (progress pings, stream-url mints, auth endpoints).
     - All non-GET requests (progress writes, mark-complete, attendance).
     - Any path the service worker cannot classify.
- **Production-only registration**: `sw.js` is registered in `app/layout.tsx` only
  when `process.env.NODE_ENV === 'production'`. In development, the service worker is
  never installed, so hot-reload is not affected.
- **Offline video intentionally unsupported**: the service worker skips all cross-origin
  requests and all non-`/_next/static/` same-origin paths, which means signed HLS
  segment requests from the video CDN are never intercepted. Offline video download
  is not supported by design (signed short-TTL URLs must not be persisted — ADR-0021).

## Consequences
- No new npm dependencies added for PWA functionality.
- The LMS is installable on Android and iOS (Chrome + Safari) and shows an offline
  fallback page when the network is unavailable.
- The cache strategy is intentionally narrow: only immutable Next.js static chunks
  are cached. Dynamic content (lesson pages, curriculum, progress) always hits the
  network. This is the safe default for an authenticated LMS; aggressive caching of
  authenticated pages risks serving stale content across sessions.
- If P6 or P7 requires more sophisticated offline support (e.g. caching program
  curricula for offline browsing), switching to Workbox at that point is low-risk
  because the hand-written `sw.js` has no API contract with application code beyond
  the registration call in `layout.tsx`.
- The dependency-approval question for `hls.js` (ADR-0026) is entirely separate;
  Workbox is not a prerequisite for resolving it.

## Alternatives considered
- **`next-pwa`**: lacked active App Router support; risk of Workbox precache
  accidentally caching signed video URLs. Rejected for P3.
- **Workbox direct**: correct tool for complex PWA caching but adds multiple
  dependencies and a build-step integration for what is currently a minimal cache
  requirement. Deferred — can be adopted in P6/P7 if offline curriculum caching
  is needed.
- **No PWA at all**: the LMS requirement explicitly calls for installability.
  Rejected.
- **Platform-managed caching only (no sw.js)**: HTTP cache headers alone (`Cache-
  Control: immutable` on static assets) provide caching but not installability or
  an offline fallback page. Rejected — installability requires a service worker and
  a web manifest.
