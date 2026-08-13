// Second-step-of-login + account-recovery mutations for 2FA-enrolled students.
//
// Kept out of the login page per CLAUDE.md §3 ("no business logic in components"),
// mirroring use-login.ts — including its `audience: "lms"` pin, which the app fixes and
// never takes from user input. Ports apps/crm/src/hooks/use-two-factor-login.ts (the
// same three endpoints, `client.auth.twoFactor.*` is shared across apps, not CRM-only).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TwoFactorLoginVerifyRequest, TwoFactorRecoveryConfirm, TwoFactorRecoveryRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { ME_QUERY_KEY } from "./use-me";

/**
 * POST /auth/2fa/login-verify — completes a login that POST /auth/login refused with
 * `auth.2fa_required`. Re-sends the credentials alongside the TOTP/backup code; the
 * server re-verifies both before issuing a session.
 */
export function useTwoFactorLoginVerify() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Omit<TwoFactorLoginVerifyRequest, "audience">) =>
      apiClient.auth.twoFactor.loginVerify({ ...body, audience: "lms" }),
    onSuccess: () => {
      // Same as useLogin: remove (not merely invalidate) so guarded views re-fetch the
      // full profile from GET /me instead of trusting the thin login payload — avoids
      // serving a stale previous-session `me` while the refetch is in flight.
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** POST /auth/2fa/recovery/request — mails a single-use code. ALWAYS succeeds generically. */
export function useRequestTwoFactorRecovery() {
  return useMutation({
    mutationFn: (body: Omit<TwoFactorRecoveryRequest, "audience">) =>
      apiClient.auth.twoFactor.requestRecovery({ ...body, audience: "lms" }),
  });
}

/**
 * POST /auth/2fa/recovery/confirm — consumes the emailed code and turns 2FA off.
 * Deliberately does NOT log the user in (the server issues no session here), so there is
 * no `me` invalidation: the form returns to the password step afterwards.
 */
export function useConfirmTwoFactorRecovery() {
  return useMutation({
    mutationFn: (body: TwoFactorRecoveryConfirm) => apiClient.auth.twoFactor.confirmRecovery(body),
  });
}
