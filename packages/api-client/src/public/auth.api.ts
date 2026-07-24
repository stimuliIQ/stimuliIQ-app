// Public self-service registration SDK — Phase 5, Wave 2
// (docs/plans/phase-5.md task #2).
//
// Namespace: client.public.auth.*
//
// Endpoint covered:
//   P-6: POST /public/register → register()
//
// Security contract:
//   - Unauthenticated (no cookieAuth — this endpoint CREATES the session).
//   - captchaToken required (fail-closed in prod — AC-14, AC-44).
//   - Rate-limited per IP (429 + Retry-After — AC-15).
//   - argon2id password hashing (server-side — CLAUDE.md §1, ADR-0002).
//   - Enumeration-resistant: duplicate email returns same response as success (AC-13).
//     The SDK treats this as a success — the UI should show the same confirmation.
//   - OTP verified as part of registration (phone ownership proof).
//   - DPDP consent stored on users row before completion (AC-37).
//   - On success: sets access_token + refresh_token + csrf_token cookies
//     and returns AuthSessionData in the body (same shape as login/otp-verify).
//     The sdk automatically primes the CSRF token for subsequent requests.
//
// Note: Before calling register(), the frontend MUST call:
//   1. client.auth.requestOtp(phone) — requests a 6-digit OTP via SMS.
//   2. client.public.auth.register({ ...fields, otpCode }) — includes the OTP code.
// The backend validates the OTP as part of the registration step.

import type { AuthSessionData } from "@repo/types";
import type { PublicRegisterDto } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicAuthApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/public/register (P-6) — UNAUTHENTICATED → creates session
   *
   * Self-service student registration for the enrollment funnel.
   * Creates a users row + student_profiles row atomically and issues
   * JWT access + refresh tokens (same AuthSessionData shape as login).
   *
   * Prerequisite: caller must have already called POST /auth/otp/request to
   * send an OTP to the phone number. The otpCode field carries that OTP.
   *
   * @param body - Registration fields including name/email/phone/password/otpCode/consent/captchaToken.
   * @returns AuthSessionData (access token in httpOnly cookie; csrfToken in body for subsequent requests).
   *
   * Errors:
   *   - 422: OTP expired, captcha failed, validation error (AC-14).
   *          For duplicate email: SAME 201 response + generic message (AC-13 — no enumeration).
   *   - 429: rate limit exceeded (AC-15).
   *
   * Authentication: None (anonymous → creates authenticated session on success).
   */
  async register(body: PublicRegisterDto): Promise<AuthSessionData> {
    const result = await this.client.request<AuthSessionData>(
      "POST",
      "/api/v1/public/register",
      { body, skipAuthRefresh: true },
    );
    // Prime the CSRF token for subsequent enroll/* requests (same as login behavior).
    if (result.csrfToken) {
      this.client.setCsrfToken(result.csrfToken);
    }
    return result;
  }
}
