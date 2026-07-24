# ADR 0002: httpOnly cookies + CSRF double-submit for auth transport

## Status
Accepted

## Context
`docs/04-trd-architecture.md §2.3` allowed either an access-token-in-memory +
httpOnly-refresh-cookie pattern, or a fully bearer-token (Authorization header)
flow, deferring cookies to a later phase. Phase-0 risk log (`docs/plans/phase-0.md`,
open question #3) asked whether to implement the full cookie+CSRF flow now or defer
it. The recommendation — implement it now, since it's the security-sensitive core
and cheap to do once across three frontends (`web`, `lms`, `crm`) that all need to
authenticate against the same API — was accepted.

## Decision
Both the access token and the refresh token are set as **httpOnly cookies** (see
`apps/api/src/modules/auth/lib/cookies.ts`), never exposed to frontend JS. CSRF
protection uses the **double-submit cookie** pattern: a non-httpOnly `csrf_token`
cookie is paired with a request header that must match it; the match is done with a
**timing-safe comparison** (Wave 6 security remediation, ADR-relevant fix M-1-adjacent
hardening). `COOKIE_SECURE` is environment-gated (`false` for local `http://`,
`true` behind HTTPS in staging/prod). CORS is a **credentialed allowlist** of exactly
`WEB_APP_URL` / `LMS_APP_URL` / `CRM_APP_URL` (Wave 6 fix M-1) — required for
cookies to be sent cross-origin from each app to the API.

`@repo/api-client` is built around this: it always sends `credentials: "include"`
and has an `onUnauthorized` refresh seam so callers don't need to touch tokens
directly.

## Consequences
- No token ever touches frontend JS/localStorage — eliminates XSS-driven token theft
  as an attack vector for both access and refresh tokens.
- Requires CSRF handling on every mutating request; the global `ZodValidationPipe`
  and the CSRF guard run ahead of business logic, adding a small amount of
  per-request overhead and complexity (header + cookie pairing) that a pure bearer
  scheme would not need.
- Couples deployment topology to cookie domain/SameSite rules — `web`/`lms`/`crm`
  must each be reachable from a domain configuration the API's `COOKIE_DOMAIN` and
  CORS allowlist can accept. This is a real constraint to carry into infra/devops
  planning for staging and prod (subdomains under one parent domain is the simplest
  path).
- Mobile/native clients (not in scope for Phase 0–P7) would need a different auth
  transport (likely bearer + secure storage) since they can't participate in the
  browser cookie/CSRF model — flagged for whenever a mobile app is scoped.

## Alternatives considered
- **Bearer token in `Authorization` header, access token held in memory only**:
  simpler CORS story (no credentialed cookies needed) and naturally mobile-friendly.
  Rejected for now because it still needs *some* persistence for refresh (usually
  ending up back at a cookie or localStorage) and the team preferred to solve the
  cookie+CSRF problem once, early, while there's only one protected route (`/me`) to
  retrofit if the decision changed.
- **Access token in memory + refresh-only httpOnly cookie** (the other option
  `docs/04 §2.3` allowed): rejected as an unnecessary split — both tokens benefit
  equally from httpOnly storage, and keeping them symmetric simplifies the rotation
  logic in `token.service.ts`.
