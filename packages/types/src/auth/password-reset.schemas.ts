// Password reset contract — Phase 9 Completion, T14/T28 (B9,
// docs/plans/phase-9-completion.md). Two-step flow: request (enumeration-resistant,
// always 200) -> tokenized email via MailProvider -> confirm (single-use, expiring
// token). Both endpoints are UNAUTHENTICATED, rate-limited, CSRF-excluded (no session
// yet — same posture as public/auth.schemas.ts `PublicRegisterDto`).

import { z } from "zod";
import { PasswordSchema } from "../common/primitives.js";
import { AppAudienceSchema } from "./auth.schemas.js";

/**
 * POST /api/v1/auth/password-reset/request
 * ALWAYS returns 200 with the same generic message regardless of whether the email
 * exists (enumeration-resistant, mirrors public/auth.schemas.ts register's AC-13
 * posture) — the email is only actually sent if a matching active user exists.
 */
export const RequestPasswordResetRequestSchema = z
  .object({
    email: z.string().email().max(254),
    // Which app initiated the reset — decides the domain of the emailed link
    // (crm → CRM_APP_URL, lms/omitted → LMS_APP_URL). Each frontend hard-codes its
    // own audience, mirroring POST /auth/login (see AppAudienceSchema). Optional so
    // the LMS default path stays backward-compatible.
    audience: AppAudienceSchema.optional(),
  })
  .strict();
export type RequestPasswordResetRequest = z.infer<typeof RequestPasswordResetRequestSchema>;

export const RequestPasswordResetResponseSchema = z.object({
  message: z.string().describe("Generic confirmation message. Never reveals whether the email exists."),
});
export type RequestPasswordResetResponse = z.infer<typeof RequestPasswordResetResponseSchema>;

/**
 * POST /api/v1/auth/password-reset/confirm
 * `token` is the single-use, short-TTL token from the reset email link. 422
 * `TOKEN_INVALID_OR_EXPIRED` on replay/expiry/tamper — a service-layer business rule,
 * not a zod shape check.
 */
export const ConfirmPasswordResetRequestSchema = z
  .object({
    token: z.string().min(16),
    newPassword: PasswordSchema,
  })
  .strict();
export type ConfirmPasswordResetRequest = z.infer<typeof ConfirmPasswordResetRequestSchema>;

export const ConfirmPasswordResetResponseSchema = z.object({
  reset: z.literal(true),
});
export type ConfirmPasswordResetResponse = z.infer<typeof ConfirmPasswordResetResponseSchema>;

/**
 * POST /api/v1/auth/change-password (lifecycle-redesign P3 — first-login flow).
 * AUTHENTICATED (unlike the reset endpoints above): the caller proves possession
 * of the CURRENT password (the system-issued temporary one on first login, or any
 * current password thereafter) and sets a new one. On success the server clears the
 * `must_change_password` gate and revokes the caller's other sessions. A wrong
 * `currentPassword` is a 422 business-rule error, not a zod shape check.
 */
export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: PasswordSchema,
  })
  .strict();
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const ChangePasswordResponseSchema = z.object({
  changed: z.literal(true),
});
export type ChangePasswordResponse = z.infer<typeof ChangePasswordResponseSchema>;
