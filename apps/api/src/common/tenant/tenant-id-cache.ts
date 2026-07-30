// apps/api/src/common/tenant/tenant-id-cache.ts
//
// Process-local memo for "tenant slug -> tenant id".
//
// WHY THIS EXISTS (2026-07-30 perf pass): every public/CMS read resolves the
// single-tenant id by slug before it can run its real query
// (`TENANT_SLUG = "stimuliiq"` in ~12 services). That lookup is a full database
// round trip for a value that is a CONSTANT for the lifetime of the process —
// a tenant's id never changes, and the slug is compiled into the source.
//
// It is worth eliminating because the production API and the database are in
// different regions: measured 2026-07-30, one Prisma round trip from the API
// host costs ~250-900 ms, so this lookup alone was ~half the server time of
// `GET /public/programs` (2.3 s total). The same endpoint served from an API
// co-located with the database answers in ~50 ms — co-locating them is the
// real fix and this cache is not a substitute for it, but the round trip is
// pure waste in either topology.
//
// SEMANTICS
//   - Positive results only. A miss (unknown/not-yet-seeded slug) is NEVER
//     cached: pinning "tenant not found" would keep a freshly seeded or
//     restored database looking broken for the whole TTL.
//   - TTL-bounded (not permanent) so a tenant row that is genuinely recreated —
//     the 2026-07 production catalog reset did exactly that — is picked up
//     without a deploy.
//   - Concurrent callers for the same slug share one in-flight promise, so a
//     cold start under load issues one query, not one per request.

/** How long a resolved id is trusted. Short enough that a re-seeded tenant recovers on its own. */
const TTL_MS = 5 * 60_000;

interface CacheEntry {
  id: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Resolve a tenant id by slug, going to `load()` only on a cold/expired entry.
 *
 * @param slug  Tenant slug (a compile-time constant at every call site today).
 * @param load  Performs the actual database lookup. Called at most once per
 *              TTL per slug, and once per cold start across concurrent callers.
 */
export async function resolveTenantIdCached(
  slug: string,
  load: () => Promise<string | null>,
): Promise<string | null> {
  const hit = cache.get(slug);
  if (hit && hit.expiresAt > Date.now()) return hit.id;

  const pending = inFlight.get(slug);
  if (pending) return pending;

  const promise = load()
    .then((id) => {
      // Negative results deliberately not cached — see SEMANTICS above.
      if (id) cache.set(slug, { id, expiresAt: Date.now() + TTL_MS });
      return id;
    })
    .finally(() => {
      inFlight.delete(slug);
    });

  inFlight.set(slug, promise);
  return promise;
}

/** Drop all memoised ids. For tests, and for any future "tenant re-provisioned" hook. */
export function clearTenantIdCache(): void {
  cache.clear();
  inFlight.clear();
}
