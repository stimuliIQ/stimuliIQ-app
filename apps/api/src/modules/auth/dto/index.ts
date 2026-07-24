// apps/api/src/modules/auth/dto/index.ts
//
// Re-exports the auth zod schemas from @repo/types (docs/04-trd-architecture.md §2.2
// module template: "dto/ — zod schemas, re-exported from @repo/types"). Never redeclare
// a shape here — this file exists purely so auth.controller.ts imports from a local,
// module-relative path while the single source of truth stays in the shared package.

export {
  LoginRequestSchema,
  type LoginRequest,
  RefreshRequestSchema,
  type RefreshRequest,
  LogoutRequestSchema,
  type LogoutRequest,
  OtpRequestRequestSchema,
  type OtpRequestRequest,
  OtpVerifyRequestSchema,
  type OtpVerifyRequest,
  ChangePasswordRequestSchema,
  type ChangePasswordRequest,
  type ChangePasswordResponse,
  type AuthSessionData,
  type OtpRequestData,
  type LogoutData,
  type MeResponse,
} from "@repo/types";
