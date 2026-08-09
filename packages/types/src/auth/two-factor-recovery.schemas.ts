// Two-factor RECOVERY contract — the "I lost my authenticator" path.
//
// Backs apps/api/src/modules/auth/two-factor-recovery.controller.ts. Two unauthenticated
// steps, deliberately modelled on password-reset.schemas.ts (B9/T28):
//   POST /api/v1/auth/2fa/recovery/request  — enumeration-resistant, ALWAYS 200
//   POST /api/v1/auth/2fa/recovery/confirm  — single-use, expiring, attempt-capped OTP
// plus one AUTHENTICATED admin rescue path (`twofa.reset`):
//   POST /api/v1/admin/users/:id/two-factor/clear
//
// WHY THE PASSWORD IS REQUIRED ON BOTH STEPS
// Recovery necessarily REMOVES a factor, so it must not be reachable with the inbox
// alone — otherwise a compromised mailbox silently downgrades every enrolled account to
// single-factor. Requiring the current password keeps the flow at two independent
// proofs (something you know + something you receive) and costs the user nothing: they
// have just typed the password into the login form that sent them here.
//
// WHY NOT REUSE THE PASSWORD-RESET TOKEN SHAPE
// Password reset mails a long opaque link token because the user must land on a page.
// Recovery mails a 6-digit code because the user is ALREADY on the login screen with the
// form open — a code they can retype is the lower-friction proof, and the short length is
// safe here only because the store caps verification attempts (see TwoFactorRecoveryStore).

import { z } from "zod";
import { AppAudienceSchema } from "./auth.schemas.js";

/**
 * POST /api/v1/auth/2fa/recovery/request
 * ALWAYS returns 200 with the same generic message — whether the email exists, whether
 * the password was right, and whether 2FA was even enrolled are all indistinguishable to
 * the caller. The mail is only actually sent when all three hold.
 */
export const TwoFactorRecoveryRequestSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).describe("Current password — recovery must never be reachable with inbox access alone."),
    // Which app initiated recovery, so the email can name the right surface. Each
    // frontend hard-codes its own audience (mirrors POST /auth/login).
    audience: AppAudienceSchema.optional(),
  })
  .strict();
export type TwoFactorRecoveryRequest = z.infer<typeof TwoFactorRecoveryRequestSchema>;

export const TwoFactorRecoveryRequestResponseSchema = z.object({
  message: z.string().describe("Generic confirmation — never reveals whether the account exists or has 2FA enrolled."),
});
export type TwoFactorRecoveryRequestResponse = z.infer<typeof TwoFactorRecoveryRequestResponseSchema>;

/**
 * POST /api/v1/auth/2fa/recovery/confirm
 * On success 2FA is DISABLED (the credential row is soft-deleted, backup codes go with
 * it) and every existing session for the user is revoked. No session is issued here —
 * the user then signs in with their password alone and re-enrols. 422
 * `RECOVERY_CODE_INVALID` on a wrong/expired/replayed code, or once the attempt cap is
 * burnt; these are service-layer business rules, not zod shape checks.
 */
export const TwoFactorRecoveryConfirmSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1),
    code: z.string().regex(/^\d{6}$/, "Must be the 6-digit code from the recovery email."),
  })
  .strict();
export type TwoFactorRecoveryConfirm = z.infer<typeof TwoFactorRecoveryConfirmSchema>;

export const TwoFactorRecoveryConfirmResponseSchema = z.object({
  reset: z.literal(true).describe("2FA is now off for this account; sign in with your password and re-enrol."),
});
export type TwoFactorRecoveryConfirmResponse = z.infer<typeof TwoFactorRecoveryConfirmResponseSchema>;

/**
 * POST /api/v1/admin/users/:id/two-factor/clear — the staff rescue path, for the case
 * where the user has lost BOTH the authenticator and access to their inbox.
 *
 * Gated on `twofa.reset`, which is deliberately a SEPARATE permission from the
 * own-scope `twofa.manage` that every role already holds — bundling them would have
 * silently handed every student the ability to strip a colleague's second factor.
 * `reason` is mandatory and lands in the audit log: an action that removes someone
 * else's second factor must never be anonymous or unexplained.
 */
export const AdminClearTwoFactorRequestSchema = z
  .object({
    reason: z.string().trim().min(10).max(500).describe("Why this reset was performed — recorded in the audit log."),
  })
  .strict();
export type AdminClearTwoFactorRequest = z.infer<typeof AdminClearTwoFactorRequestSchema>;

export const AdminClearTwoFactorResponseSchema = z.object({
  cleared: z.boolean().describe("False when the target had no 2FA enrolled — the call is idempotent, not an error."),
});
export type AdminClearTwoFactorResponse = z.infer<typeof AdminClearTwoFactorResponseSchema>;
