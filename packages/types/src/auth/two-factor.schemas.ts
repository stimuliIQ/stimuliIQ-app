// Two-factor authentication (TOTP) contract — Phase-9-completion gap #8 (promoted from
// apps/api/src/modules/auth/dto/two-factor.schemas.ts, T28's original apps/api-only
// scope). Backs `apps/api/src/modules/auth/two-factor.controller.ts`'s
// `/api/v1/auth/2fa/*` routes exactly — own-scope enroll/verify/disable/status
// (JwtAuthGuard, `twofa.manage` permission) plus the unauthenticated second step of a
// 2FA login (`POST /api/v1/auth/2fa/login-verify`).

import { z } from "zod";
import { AppAudienceSchema } from "./auth.schemas.js";

export const TotpEnrollResponseSchema = z.object({
  secret: z.string().describe("Base32 TOTP secret — shown once for manual entry if the app cannot scan a QR code."),
  otpauthUrl: z.string().describe("otpauth://totp/... URI — the frontend renders this as a QR code for scanning."),
});
export type TotpEnrollResponse = z.infer<typeof TotpEnrollResponseSchema>;

export const TotpVerifyEnrollRequestSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, "Must be a 6-digit TOTP code."),
  })
  .strict();
export type TotpVerifyEnrollRequest = z.infer<typeof TotpVerifyEnrollRequestSchema>;

export const TotpVerifyEnrollResponseSchema = z.object({
  enabled: z.literal(true),
  backupCodes: z.array(z.string()).describe("Single-use backup codes — shown ONCE, never retrievable again."),
});
export type TotpVerifyEnrollResponse = z.infer<typeof TotpVerifyEnrollResponseSchema>;

export const TotpDisableRequestSchema = z
  .object({
    code: z.string().min(6).max(11).describe("A current TOTP code OR an unused backup code — required to disable 2FA."),
  })
  .strict();
export type TotpDisableRequest = z.infer<typeof TotpDisableRequestSchema>;

export const TotpStatusResponseSchema = z.object({
  enabled: z.boolean(),
  remainingBackupCodes: z.number().int().min(0).nullable().describe("Null when 2FA is not enabled."),
});
export type TotpStatusResponse = z.infer<typeof TotpStatusResponseSchema>;

/** POST /api/v1/auth/2fa/login-verify — UNAUTHENTICATED (no session exists yet). */
export const TwoFactorLoginVerifyRequestSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1),
    code: z.string().min(6).max(11).describe("A current TOTP code OR an unused backup code."),
    // Same app/role boundary gate as POST /auth/login (see AppAudienceSchema). The
    // final session is issued by AuthService.login(), which enforces this.
    audience: AppAudienceSchema.optional(),
  })
  .strict();
export type TwoFactorLoginVerifyRequest = z.infer<typeof TwoFactorLoginVerifyRequestSchema>;
