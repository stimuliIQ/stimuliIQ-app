# ADR 0019: Public unauthenticated booking-intake endpoint

## Status
Accepted

## Context
`docs/01-prd-website.md` requires a "book a counselling slot" funnel that a prospective
student can complete from the marketing website without being logged in. Phase 5 will
build the full website, but the funnel needs a backend entry point now so that:

1. The data model is proven before P5 front-end work begins.
2. The CRM can receive bookings from external forms or a bare `curl` call during testing
   without requiring an authenticated session.

The standard API surface is authenticated (JWT access token + CSRF double-submit). The
intake endpoint must be `@Public` and CSRF-exempt because the caller is a browser with
no pre-existing session.

Security risks: over-posting (extra fields accepted and persisted), spam/enumeration
(unauthenticated callers can probe the API freely), tenant leakage (caller could try to
book under a different tenant), and injection via arbitrary `source` / `utm` fields.

## Decision
`POST /api/v1/public/bookings` is:

- **`@Public`**: exempt from JWT authentication guard.
- **CSRF-excluded**: listed in `AppModule`'s CSRF exclusion list alongside the webhook
  endpoint. No `x-csrf-token` header is required.
- **Rate-limited per source IP via Redis**: a sliding-window limiter (shared with the
  existing login rate limiter infrastructure) restricts the number of booking-intake
  requests per IP per time window, making spam/enumeration costly.
- **Strict-zod validated**: the request body schema (`CreatePublicBookingDto`) is
  defined in `@repo/types` and validated through `ZodValidationPipe`. Only the
  explicitly declared fields are accepted; extra fields are stripped. The `source` field
  is constrained to an allowlist (`web_form`, `referral`, `campaign`); arbitrary strings
  are rejected.
- **Server-resolved tenant**: the tenant is resolved from the request host (or a
  configured `TENANT_SLUG` for the single-tenant MVP). The caller never supplies a
  `tenant_id`; they cannot book under a different tenant.
- **Creates lead + booking atomically**: the handler creates (or upserts by phone number)
  a `Lead` row and a `Booking` row in a single `$transaction`. The resulting IDs are
  returned to the caller for tracking (not sensitive data).

## Consequences
- The P5 marketing website has a concrete, tested endpoint to wire up without any
  schema or contract change.
- The rate-limit + strict-zod combination prevents both data over-posting and
  volumetric abuse without requiring authentication.
- Server-resolved tenant means the endpoint cannot be multi-tenanted until the
  multi-tenant resolution strategy (noted in `docs/phase-1-followups.md`) is
  implemented. For the single-tenant MVP this is acceptable.
- The endpoint is in the `public` URL namespace (`/api/v1/public/...`), making it easy
  to distinguish from authenticated routes in CORS policy, WAF rules, and logs.

## Alternatives considered
- **Require an API key for public intake**: adds friction for the marketing website
  (must handle key rotation, key leakage). Rejected for MVP — rate limiting achieves
  the same spam-prevention goal without key management overhead.
- **Accept arbitrary `source` / `utm` strings without validation**: simpler but
  allows injection of garbage data into the leads pipeline. Rejected — an allowlist
  for `source` and length-limited `utm` fields are cheap guards.
- **Create the booking endpoint only in P5**: defers testing the data path. Rejected —
  the backend contract being live and testable in P2 reduces integration risk in P5.
