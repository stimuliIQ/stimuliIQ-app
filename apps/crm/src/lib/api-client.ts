// Singleton @repo/api-client instance for `crm`. Components/hooks import this
// — never construct a client or call `fetch` directly (CLAUDE.md §3.2,
// docs/04-trd-architecture.md §3.5).
//
// onUnauthorized wiring: on a 401, attempt one refresh via the rotating
// httpOnly refresh cookie; resolve "retried" so the original request replays
// once, or "failed" so the 401 surfaces to the caller (the UI then renders
// the signed-out empty state instead of crashing — see useMe()).
import { createApiClient } from "@repo/api-client";

// Vite inlines `import.meta.env.VITE_*` at build time — never `process.env` in
// browser code (CLAUDE.md §3.12: no secret/runtime env leakage assumptions).
const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

export const apiClient = createApiClient({
  baseUrl,
  // Use the "crm" session cookie slot — lets a staff CRM session coexist with a
  // student LMS session in the same browser (see api-client ApiClientConfig.appAudience).
  appAudience: "crm",
  onUnauthorized: async () => {
    try {
      await apiClient.auth.refresh();
      return "retried";
    } catch {
      return "failed";
    }
  },
});
