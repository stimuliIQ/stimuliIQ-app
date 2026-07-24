// Public self-service registration DTO — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// POST /api/v1/public/register (P-6)
//
// Enables anonymous visitors to create a student account as part of the
// enrollment funnel: Program → Enroll → Register/Login → Order → Checkout → Verify.
//
// This is a NEW registration path that does NOT exist in the auth module today.
// The AuthService gets a new `publicRegister()` method; this DTO is its input contract.
//
// Security constraints (AC-12..AC-15):
//   - captchaToken: REQUIRED. Backend verifies before any DB write. Fail-closed.
//   - Rate-limited per IP (429 + Retry-After). Fail-closed on Redis error (AC-43).
//   - No account enumeration: duplicate email returns the SAME generic response as
//     success (AC-13 — the API MUST NOT reveal whether an email is already registered).
//   - argon2id password hashing (CLAUDE.md §1, ADR-0002).
//   - CSRF-excluded (separate public controller, no session pre-auth).
//   - .strict() over-post stripping.
//   - OTP-verify reuse: phone verification via existing /auth/otp/verify path.
//   - Consent stored on the users row before the row is considered complete.
//
// Session issuance: on success, the response includes access + refresh tokens
// (same shape as AuthSessionDataSchema from auth/auth.schemas.ts — reused here).
// The newly registered student is immediately authenticated and can proceed to
// POST /public/enroll/orders without a separate login step.
//
// OTP flow: registration does NOT issue OTP itself. The frontend calls:
//   1. POST /auth/otp/request   (existing; requests OTP for phone)
//   2. POST /public/register    (this endpoint; includes phone + password + consent)
// The backend validates the OTP as part of the registration (reusing OtpService).
// If OTP expired: 422, no users row created (AC edge case).

import { z } from "zod";
import { PhoneSchema, PasswordSchema } from "../common/primitives.js";
import { PublicConsentSchema } from "./leads.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// PublicRegisterDto — POST /api/v1/public/register
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/public/register (UNAUTHENTICATED → creates authenticated session)
 *
 * Self-service account creation for the enrollment funnel. Creates a `users` row
 * and a `student_profiles` row atomically and issues JWT access + refresh tokens.
 *
 * On success: returns AuthSessionData (same as login/otp-verify response).
 * On duplicate email: returns same shape + generic message (AC-13, no enumeration).
 * On captcha fail: 422, no DB write (AC-14).
 * On OTP expiry: 422, no DB write.
 * On rate-limit: 429 + Retry-After (AC-15).
 *
 * Permissions: None (anonymous public endpoint).
 */
export const PublicRegisterDtoSchema = z
  .object({
    name: z.string().min(1).max(200).describe("Student's full name."),
    email: z.string().email().max(254).describe("Student's email address (becomes login credential)."),
    phone: PhoneSchema.describe(
      "Student's phone number (must match the phone used in the OTP request).",
    ),
    /**
     * The OTP code received via SMS (from a prior POST /auth/otp/request call).
     * The backend validates this as part of registration to prove phone ownership.
     */
    otpCode: z
      .string()
      .regex(/^\d{6}$/, "OTP must be exactly 6 digits")
      .describe("6-digit OTP received via SMS."),
    password: PasswordSchema.describe(
      "Password: min 10 chars, max 128, at least one letter + one digit.",
    ),
    /** DPDP consent from the registration form checkboxes. */
    consent: PublicConsentSchema.describe("DPDP consent from the registration form."),
    /**
     * Captcha verification token. Required. Verified server-side before any DB write.
     * Fail-closed in prod (AC-14, AC-44).
     */
    captchaToken: z
      .string()
      .min(1)
      .describe("Captcha token from the client-side widget. Required. Fail-closed in prod."),
  })
  .strict();
export type PublicRegisterDto = z.infer<typeof PublicRegisterDtoSchema>;
