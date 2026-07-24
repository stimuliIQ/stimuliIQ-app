// apps/api/src/modules/auth/dto/two-factor.schemas.ts
//
// Re-exports the 2FA (TOTP) zod schemas from @repo/types (CLAUDE.md §3.2: "DTOs in
// @repo/types, reused FE+BE"). Promoted in Phase-9-completion gap #8 — these shapes
// used to be declared locally here (T28's original apps/api-only task scope); now
// packages/types/src/auth/two-factor.schemas.ts is the single source of truth and
// packages/api-client/src/auth/two-factor.api.ts (client.auth.twoFactor.*) consumes the
// SAME types. Never redeclare a shape here.

export {
  TotpEnrollResponseSchema,
  type TotpEnrollResponse,
  TotpVerifyEnrollRequestSchema,
  type TotpVerifyEnrollRequest,
  TotpVerifyEnrollResponseSchema,
  type TotpVerifyEnrollResponse,
  TotpDisableRequestSchema,
  type TotpDisableRequest,
  TotpStatusResponseSchema,
  type TotpStatusResponse,
  TwoFactorLoginVerifyRequestSchema,
  type TwoFactorLoginVerifyRequest,
} from "@repo/types";
