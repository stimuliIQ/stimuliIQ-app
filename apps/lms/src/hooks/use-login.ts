// Login mutation — authenticates a student and refreshes the cached `me`
// query so guarded views re-render into the authenticated state. Kept out of
// the login page component per CLAUDE.md §3 ("no business logic in components").
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LoginRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { ME_QUERY_KEY } from "./use-me";

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    // `audience: "lms"` is fixed by the app, never taken from user input — the server
    // rejects any non-student account signing into the student portal (see @repo/types
    // AppAudienceSchema). Overrides any audience that might be on `body`.
    mutationFn: (body: LoginRequest) => apiClient.auth.login({ ...body, audience: "lms" }),
    onSuccess: () => {
      // Remove (not merely invalidate) so guarded views re-fetch the full profile
      // from GET /me rather than trusting the thin login payload. Invalidation keeps
      // serving the PREVIOUS session's cached profile while the refetch is in flight —
      // a stale `mustChangePassword: true` from a pre-password-change session would
      // make FirstLoginGate bounce the fresh login back to /change-password.
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
