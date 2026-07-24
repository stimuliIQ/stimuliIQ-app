// Request-password-reset mutation for the public `/forgot-password` page.
// UNAUTHENTICATED. Mirrors use-profile-settings.ts's `resetMutation` (the
// logged-in "change password" card reuses the same endpoint) but kept as its
// own hook since this one has no signed-in `me` to pre-fill an email from,
// and no other settings state to bundle it with. Kept out of the page
// component per CLAUDE.md §3 ("no business logic in components").
"use client";

import { useMutation } from "@tanstack/react-query";
import type { RequestPasswordResetRequest, RequestPasswordResetResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export function useRequestPasswordReset() {
  return useMutation<RequestPasswordResetResponse, unknown, RequestPasswordResetRequest>({
    mutationFn: (body) => apiClient.auth.requestPasswordReset(body),
  });
}
