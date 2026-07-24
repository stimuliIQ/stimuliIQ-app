// Singleton @repo/api-client instance for `web`. Components/hooks import this —
// never construct a client or call `fetch` directly (CLAUDE.md §3.2,
// docs/04-trd-architecture.md §3.5).
//
// Two instances:
//   `apiClient`       — client-side singleton (used in hooks / client components).
//                       Reads NEXT_PUBLIC_API_URL (public, bundled).
//                       Retries on 401 via the rotating refresh cookie.
//   `serverApiClient` — server-side instance for RSC / sitemap / generateMetadata.
//                       Prefers private API_URL (not exposed to the client bundle).
//
// onUnauthorized wiring: on a 401, attempt one refresh via the rotating
// httpOnly refresh cookie; resolve "retried" so the original request replays
// once, or "failed" so the 401 surfaces to the caller (the UI then renders
// the signed-out empty state instead of crashing — see useMe()).
import { createApiClient } from "@repo/api-client";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const apiClient = createApiClient({
  baseUrl,
  // The web funnel acts on behalf of STUDENTS (register → auto-login → LMS), so it
  // shares the "lms" session cookie slot with the LMS app — a staff CRM session in
  // the same browser is unaffected (see api-client ApiClientConfig.appAudience).
  appAudience: "lms",
  onUnauthorized: async () => {
    try {
      await apiClient.auth.refresh();
      return "retried";
    } catch {
      return "failed";
    }
  },
});

// ---------------------------------------------------------------------------
// Server-side client — used in RSC pages, generateMetadata, sitemap.ts
// Prefers the private API_URL env var (never bundled); falls back to the public var.
// ---------------------------------------------------------------------------
export const serverApiClient = createApiClient({
  baseUrl:
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000",
  onUnauthorized: async () => "failed",
});
