/* stimuliiq LMS — hand-written service worker (Wave 5b).
 *
 * NO next-pwa / Workbox — a small, auditable, dependency-free app-shell cache
 * (CLAUDE.md: ask before installing anything unspecified).
 *
 * STRATEGY
 *   - Navigations (HTML): network-first → runtime cache → offline fallback.
 *     Keeps content fresh; degrades to the last-seen page (or an offline card)
 *     when the network is down.
 *   - Immutable static assets (/_next/static/*, icons): cache-first (hashed URLs
 *     never change, so a stale cache entry is always safe).
 *   - EVERYTHING ELSE (cross-origin API calls, signed HLS video, POST/PUT/etc.):
 *     bypassed entirely — network only, never cached.
 *
 * SECURITY (docs/plans/phase-3.md §Risks, CLAUDE.md §video):
 *   - Signed stream-url responses are SHORT-TTL + per-user and MUST NEVER be
 *     cached. They are cross-origin (backend/CDN) and are skipped by the
 *     same-origin guard below. We additionally never cache non-GET requests.
 *   - No API/auth responses are cached (cross-origin → skipped).
 *
 * DEV SAFETY VALVE (v2):
 *   This SW is only ever REGISTERED in production (service-worker-register.tsx
 *   guards on NODE_ENV === "production"). But a registration from an earlier
 *   prod run on localhost persists into local dev on the same origin, where it
 *   would serve cached prod `/_next/static/*` chunks (hashed in prod, but the
 *   dev runtime expects fresh unhashed chunks) → "Cannot read properties of
 *   undefined (reading 'call')". A registered SW survives .next clears and hard
 *   refreshes; the only way to evict it is to ship a newer SW that stands down.
 *   So on a localhost origin this SW purges its caches, unregisters itself, and
 *   reloads open tabs — network-only, no interception. In production it behaves
 *   exactly as documented above. (This replaces the temporary kill-switch that
 *   used to live at this path — no separate file to remember to restore.)
 */

const SW_VERSION = "v2";
const RUNTIME_CACHE = `stimuliiq-lms-runtime-${SW_VERSION}`;
const STATIC_CACHE = `stimuliiq-lms-static-${SW_VERSION}`;
const OFFLINE_URL = "/offline";

// Minimal precache: the offline fallback + the app icon.
const PRECACHE_URLS = [OFFLINE_URL, "/icon.svg"];

// True when this SW is running on a local development origin. On such origins the
// SW must never cache/intercept (see "DEV SAFETY VALVE" above).
const IS_DEV_ORIGIN =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.hostname === "[::1]" ||
  self.location.hostname === "0.0.0.0";

self.addEventListener("install", (event) => {
  // On a dev origin, don't precache anything — just take over so `activate` can
  // immediately stand this SW down (below).
  if (IS_DEV_ORIGIN) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        /* offline install — precache is best-effort */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Dev safety valve: a stale prod registration leaked onto localhost. Purge
      // everything, unregister, and reload open tabs so dev is served straight
      // from the network with no SW in the way.
      if (IS_DEV_ORIGIN) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
          await self.clients.claim();
          await self.registration.unregister();
          const clients = await self.clients.matchAll({ type: "window" });
          for (const client of clients) {
            if ("navigate" in client) client.navigate(client.url);
          }
        } catch {
          /* best-effort */
        }
        return;
      }

      // Production: drop caches from previous SW_VERSIONs, then take control.
      const keep = new Set([RUNTIME_CACHE, STATIC_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isImmutableStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/icon-maskable.svg"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET. Never touch POST/PUT/DELETE (mutations, progress pings).
  if (request.method !== "GET") return;

  // Dev safety valve: on a localhost origin, never intercept or cache — let every
  // request hit the network while `activate` unregisters this SW.
  if (IS_DEV_ORIGIN) return;

  const url = new URL(request.url);

  // Same-origin only. Cross-origin (backend API, signed HLS video CDN) is left
  // to the network untouched — signed URLs must never be cached.
  if (url.origin !== self.location.origin) return;

  // Immutable hashed static assets → cache-first.
  if (isImmutableStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations (HTML documents) → network-first with runtime-cache fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return (
            offline ||
            new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }),
    );
  }

  // All other same-origin GETs (fonts, images) fall through to the network.
});
