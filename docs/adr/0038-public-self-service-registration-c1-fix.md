# ADR 0038: Public self-service registration (`POST /public/register`) and C-1 account-takeover fix

## Status

Accepted

## Context

Before Phase 5, there was no public self-service account creation. Students were either
created CRM-side (P1) or via lead-conversion (P2). The enroll funnel (`docs/01 §7.8`)
requires a new visitor to create an account before paying.

The Wave 7 security review identified **C-1 (Critical)**: an initial implementation of
`POST /public/register` for an already-registered email was minting a session for the
existing account. Because OTP verification proves ownership of the *phone number in the
request* (caller-controlled), not ownership of the *email account* (victim-controlled),
issuing a session for the existing account would allow an attacker to take over any
account whose email address they know by supplying their own phone and completing OTP.

## Decision

### Registration flow

`POST /public/register` accepts `{name, email, password, phone, tosVersion, marketingOptIn, captchaToken}`.

For a **new email** (happy path):
1. Captcha-gated (ADR-0036), rate-limited, honeypot-checked.
2. Password hashed with `argon2id`.
3. Phone OTP verified via the existing `OtpStore` (reuses `POST /auth/otp/verify` logic).
4. `users` row + `student_profiles` row created atomically.
5. DPDP consent recorded on the `users` row (or a related profile column).
6. JWT access token + rotating refresh token issued via `TokenService` (ADR-0003).
7. `setAuthCookies` writes the tokens into the response (ADR-0002).
8. Response: 201 with `AuthSessionData` (same shape as login response).

### C-1 fix — existing email path

For an **existing email**, the service:
1. Detects the pre-existing `users` row.
2. Logs a warning with NO caller-supplied details beyond a redacted indicator.
3. Returns a **201-shaped `AuthSessionData` body built entirely from the caller-supplied
   input** (name from the request, no real `userId`, no tokens).
4. The controller receives `tokens: null` from the service and therefore calls
   `setAuthCookies` only when tokens are present — so **no cookies are set, no session
   is granted**.
5. The response body is structurally indistinguishable from a successful registration
   (same HTTP status, same JSON shape, same timing characteristics) — enumeration-
   resistant (AC-13).

This is the critical invariant: **OTP verification of a phone number does not confer
ownership of an email account.** A session is only issued for a newly created account
where the caller has just set the password.

Integration test assertions updated in `public.integration.spec.ts` and
`public-funnel.service.spec.ts` to assert: existing-email registration returns no
`Set-Cookie` header, no access token, and no refresh token.

### Enrollment flow linkage

After registration, the student session is used by `POST /public/enroll/orders` (P-7),
`/checkout` (P-8), and `/verify` (P-9). All three enroll endpoints are guarded by
`JwtAuthGuard` and enforce `own`-scope (`order.studentId === req.user.id` → else 404)
at the service layer.

## Consequences

- C-1 is fully remediated: an attacker who knows a victim's email and completes OTP for
  their own phone receives a plausible-looking 201 response with no session and no tokens.
- Enumeration is prevented: the response shape, HTTP status, and approximate timing are
  the same for new and existing emails.
- Returning users (who already have an account) will not receive a session from
  `/public/register`; the UI should detect the no-cookie response and redirect to
  `/login`. This is a UX follow-up tracked in `docs/phase-5-followups.md`.
- Password hashing uses `argon2id` (same as the rest of the auth system). Cost parameters
  are inherited; the carried P0 follow-up (argon2id cost parameter pinning) applies here too.
- The `public/register` path is rate-limited per IP (AC-15), captcha-gated (AC-14), and
  honeypot-protected (AC-42) before any DB read.

## Alternatives considered

- **Issue a session + trigger an email alert to the existing account**: rejected — emits
  PII to the attacker (confirms the email is registered + is an active account); also
  requires MailProvider which is P6.
- **Return 409 Conflict for existing email**: rejected — reveals that the email is already
  registered (enumeration), enabling targeted credential-stuffing setup.
- **Redirect to login with an opaque token**: rejected — requires the backend to store
  state and adds a round-trip; the caller (web funnel) can achieve the same UX client-side
  by detecting the no-token response.
