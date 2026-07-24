// Singleton @repo/api-client instance for `lms`. Components/hooks import this
// — never construct a client or call `fetch` directly (CLAUDE.md §3.2,
// docs/04-trd-architecture.md §3.5).
//
// onUnauthorized wiring: on a 401, attempt one refresh via the rotating
// httpOnly refresh cookie; resolve "retried" so the original request replays
// once, or "failed" so the 401 surfaces to the caller (the UI then renders
// the signed-out empty state instead of crashing — see useMe()).
import { createApiClient } from "@repo/api-client";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const apiClient = createApiClient({
  baseUrl,
  // Use the "lms" session cookie slot — lets a student LMS session coexist with a
  // staff CRM session in the same browser (see api-client ApiClientConfig.appAudience).
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
