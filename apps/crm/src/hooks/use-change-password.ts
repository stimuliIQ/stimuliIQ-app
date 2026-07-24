// Self-service "Change password" mutation for the authenticated CRM account menu
// (components/account/change-password-dialog.tsx). POST /api/v1/auth/change-password
// verifies the current password, rejects reuse, and on success revokes ALL of the
// caller's sessions server-side and clears cookies (see AuthApi.changePassword's doc
// and auth.service.ts#changePassword) — there is no "keep this session" option.
//
// So, exactly like useLogout, this hook invalidates the cached `me` query on success:
// the next /me fetch 401s, useMe() reports isSignedOut, and AppShell swaps back to the
// sign-in screen on its own — no manual routing needed here. Kept out of the dialog
// component per CLAUDE.md §3 ("no business logic in components").
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { ChangePasswordRequest, ChangePasswordResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { ME_QUERY_KEY } from "./use-me";

export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation<ChangePasswordResponse, ApiError, ChangePasswordRequest>({
    mutationFn: (body) => apiClient.auth.changePassword(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
