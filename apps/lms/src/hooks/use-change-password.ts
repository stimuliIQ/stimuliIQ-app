// First-login / self-service change-password mutation (lifecycle-redesign P3).
// AUTHENTICATED. Sends the current (temporary) password + a new one to
// POST /api/v1/auth/change-password. On success the server revokes ALL sessions
// and clears cookies, so the page routes to /login afterwards. Kept out of the
// page component per CLAUDE.md §3 ("no business logic in components").
"use client";

import { useMutation } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { ChangePasswordRequest, ChangePasswordResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export function useChangePassword() {
  return useMutation<ChangePasswordResponse, ApiError, ChangePasswordRequest>({
    mutationFn: (body) => apiClient.auth.changePassword(body),
  });
}
