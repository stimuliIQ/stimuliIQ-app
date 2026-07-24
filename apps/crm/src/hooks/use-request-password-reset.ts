// Request-password-reset mutation for the public `/forgot-password` route.
// UNAUTHENTICATED. Kept out of the route component per CLAUDE.md §3 ("no
// business logic in components").
import { useMutation } from "@tanstack/react-query";
import type { RequestPasswordResetRequest, RequestPasswordResetResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export function useRequestPasswordReset() {
  return useMutation<RequestPasswordResetResponse, unknown, RequestPasswordResetRequest>({
    mutationFn: (body) => apiClient.auth.requestPasswordReset(body),
  });
}
