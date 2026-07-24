// Login mutation — authenticates a staff user and refreshes the cached `me`
// query so the app shell re-renders into the authenticated state. Kept out of
// the login form component per CLAUDE.md §3 ("no business logic in components").
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LoginRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { ME_QUERY_KEY } from "./use-me";

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    // `audience: "crm"` is fixed by the app, never taken from user input — the server
    // rejects any non-staff account signing into the admin dashboard (see @repo/types
    // AppAudienceSchema). Overrides any audience that might be on `body`.
    mutationFn: (body: LoginRequest) => apiClient.auth.login({ ...body, audience: "crm" }),
    onSuccess: () => {
      // Invalidate (not just set) so the shell re-fetches the full RBAC
      // profile from GET /me rather than trusting the thin login payload.
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
