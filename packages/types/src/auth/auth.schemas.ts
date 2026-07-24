// Auth contract DTOs — Phase 0, Wave 3 (docs/plans/phase-0.md task #7).
//
// Transport: httpOnly cookies + CSRF (LOCKED). Login/refresh/otp-verify set
// `access_token` + `refresh_token` as httpOnly, Secure, SameSite=Lax cookies
// on the response — neither token ever appears in a JSON body. Logout clears
// both cookies. Refresh is rotating + single-use with reuse-family-revocation
// (docs/04-trd-architecture.md §2.3). A separate, NON-httpOnly `csrf_token`
// cookie is set alongside the auth cookies; the frontend must echo its value
// back in the `X-CSRF-Token` header on every unsafe (non-GET) request — the
// classic double-submit pattern. @repo/api-client implements this read/echo
// for the FE so feature code never touches cookies directly.

import { z } from "zod";
import { UuidSchema, PhoneSchema, PasswordSchema, OtpCodeSchema, PermissionGrantSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * Which first-party app a session is being requested for. The server rejects a
 * login whose account role does not belong to the target app (a `student` can
 * only sign into `lms`; any staff role — admin/faculty/mentor/… — can only sign
 * into `crm`). This is the app/role BOUNDARY gate, layered on top of per-endpoint
 * RBAC: it stops a staff member landing in the student portal (and vice-versa)
 * at the login form, not just at each API call.
 *
 * Each frontend hard-codes its own audience (LMS→"lms", CRM→"crm") — it is NOT
 * user-selectable. Optional on the wire for backward-compatibility with existing
 * server-to-server/test callers; when present it is always enforced.
 */
export const AppAudienceSchema = z.enum(["lms", "crm"]);
export type AppAudience = z.infer<typeof AppAudienceSchema>;

/** POST /api/v1/auth/login */
export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: PasswordSchema,
  audience: AppAudienceSchema.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * POST /api/v1/auth/refresh
 * Body is empty — the rotating refresh token travels via the httpOnly
 * `refresh_token` cookie. Declared as an empty object (not `z.void()`) so
 * NestJS's global ZodValidationPipe has a concrete schema to validate
 * against, and so the OpenAPI request body is explicit (empty object) rather
 * than absent.
 */
export const RefreshRequestSchema = z.object({}).strict();
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

/**
 * POST /api/v1/auth/logout
 * Body is empty — the session to revoke is identified by the cookie.
 */
export const LogoutRequestSchema = z.object({}).strict();
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

/** POST /api/v1/auth/otp/request */
export const OtpRequestRequestSchema = z.object({
  phone: PhoneSchema,
});
export type OtpRequestRequest = z.infer<typeof OtpRequestRequestSchema>;

/** POST /api/v1/auth/otp/verify */
export const OtpVerifyRequestSchema = z.object({
  phone: PhoneSchema,
  code: OtpCodeSchema,
  audience: AppAudienceSchema.optional(),
});
export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Minimal user shape returned on login/otp-verify. Deliberately thin — no
 * entity leakage (CLAUDE.md §3: "response DTOs minimal"). Roles/permissions
 * are NOT included here; fetch `GET /api/v1/me` for the full RBAC profile.
 */
export const UserSummarySchema = z.object({
  id: UuidSchema,
  email: z.string().email(),
  phone: z.string().nullable(),
  name: z.string(),
  avatar: z.string().url().nullable(),
  status: z.enum(["active", "invited", "suspended", "deactivated"]),
  // First-login onboarding gate (lifecycle-redesign P3). True when the account
  // was auto-provisioned with a temporary password and the user must set a new
  // one before using the LMS. The LMS reads this off login + /me and forces the
  // change-password screen; server-side, protected routes still enforce it.
  mustChangePassword: z.boolean().default(false),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

/**
 * Data payload of POST /auth/login, /auth/refresh, /auth/otp/verify.
 * Tokens are NOT in this body (see file header) — only the CSRF token the
 * frontend needs to read once and echo back on subsequent unsafe requests.
 */
export const AuthSessionDataSchema = z.object({
  user: UserSummarySchema,
  csrfToken: z.string().min(16).describe("Echo this value in the X-CSRF-Token header on unsafe requests."),
});
export type AuthSessionData = z.infer<typeof AuthSessionDataSchema>;

/** Data payload of POST /auth/otp/request — never echoes the code back. */
export const OtpRequestDataSchema = z.object({
  phone: PhoneSchema,
  expiresInSeconds: z.number().int().positive(),
  /** True once SmsProvider is wired to MSG91; false while OTP send is stubbed (Phase 0). */
  delivered: z.boolean(),
});
export type OtpRequestData = z.infer<typeof OtpRequestDataSchema>;

/** Data payload of POST /auth/logout — explicit empty success marker. */
export const LogoutDataSchema = z.object({
  loggedOut: z.literal(true),
});
export type LogoutData = z.infer<typeof LogoutDataSchema>;

/**
 * Data payload of GET /api/v1/me — the protected route RBAC/scope is proven
 * on. `roles` are role keys (e.g. `admin`, `counsellor`); `permissions` is
 * the flattened, resolved grant list (module.action + scope) the frontend
 * uses to hide UI the API would forbid (CLAUDE.md §3.5 — never trust client
 * for actual enforcement, this is presentation-only).
 */
export const MeResponseSchema = z.object({
  user: UserSummarySchema,
  tenantId: UuidSchema,
  roles: z.array(z.string().min(1)),
  permissions: z.array(PermissionGrantSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
