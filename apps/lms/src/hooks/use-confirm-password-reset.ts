// Confirm-password-reset mutation for the public `/reset-password` page.
// UNAUTHENTICATED. Consumes the single-use, short-TTL token from the emailed
// reset link (see apps/api/src/modules/auth/password-reset.service.ts) — a
// 422 TOKEN_INVALID_OR_EXPIRED means the link was already used, expired, or
// tampered with. Kept out of the page component per CLAUDE.md §3 ("no
// business logic in components").
"use client";

import { useMutation } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { ConfirmPasswordResetRequest, ConfirmPasswordResetResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export function useConfirmPasswordReset() {
  return useMutation<ConfirmPasswordResetResponse, ApiError, ConfirmPasswordResetRequest>({
    mutationFn: (body) => apiClient.auth.confirmPasswordReset(body),
  });
}
