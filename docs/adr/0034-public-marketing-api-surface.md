# ADR 0034: Public marketing API surface — read-mostly endpoints reusing P1/P2 service engines

## Status

Accepted

## Context

Phase 5 needs a public-facing catalog and self-service payment funnel. The existing
CRM catalog endpoints (`GET /crm/courses`, `/crm/courses/:id`) are guarded by
`JwtAuthGuard` + `courses.view` permission. The commerce endpoints (`POST /commerce/orders`,
`/orders/:id/pay`, `/payments/verify`, `/coupons/validate`) require `orders.create` /
`payments.create` / `coupons.view` permissions scoped to Finance/Owner/Admin roles.
Anonymous visitors and self-registering students cannot reach any of these.

A naive approach would duplicate the service logic in new controllers. That would create
a second, divergent money-handling path — a critical audit/security failure.

## Decision

Introduce a **`public` NestJS module** with three controller classes following the
`PublicBookingsController` separation pattern (ADR-0019):

| Controller | Routes | Auth |
|---|---|---|
| `PublicCatalogController` | `GET /public/programs`, `GET /public/programs/:slug` | None (CSRF-excluded) |
| `PublicAnonymousWriteController` | `POST /public/leads`, `POST /public/coupons/validate`, `POST /public/register` | None (CSRF-excluded; captcha-gated) |
| `PublicEnrollController` | `POST /public/enroll/orders`, `/checkout`, `/verify` | `JwtAuthGuard` (own-scope only; CSRF enforced) |

All nine public endpoints (P-1 through P-9 in `docs/plans/phase-5.md §2`) **reuse the
existing service engines**:

- `CoursesService` read path — `PublicCatalogService` calls it with a public-projection
  allowlist (defined in `docs/specs/phase-5-website.md §Public-Projection Allowlist`).
- `LeadsService` — lead creation via `PublicRepository.createLead` with P5 attribution fields.
- `CommerceService.createOrder` / `initiateRazorpayCheckout` / `verifyPayment` — the P2
  idempotency, `PaymentProvider` signature-verify, and order→enrollment atomicity (ADR-0014)
  are **inherited unchanged**.

The public funnel differs from the CRM path only in:

1. **Authorization model**: `own`-scope enforced directly in `PublicFunnelService` as
   `order.studentId === req.user.id` (no `PermissionsGuard`, no `role_permissions` table
   lookup). Cross-student access returns 404 (IDOR→404, AC-22).
2. **Public-projection allowlist**: `GET /public/programs` and `GET /public/programs/:slug`
   never select draft programs (`status !== 'published'`), non-public programs
   (`is_public = false`), or any forbidden field (storage keys, answer keys, PII, internal
   IDs). This contract is a repository-level query shape, not a post-query filter.
3. **Captcha gate**: all anonymous writes are blocked by `CaptchaProvider.verify` before
   any DB write (ADR-0037 governs the provider; fail-closed in prod).

`programs.is_public` explicitly separates the CRM concept of "published" (content-ready,
visible in the CRM) from "publicly listable on the marketing site." A program must be
`status = published AND is_public = true` to appear on `GET /public/programs`.

## Consequences

- No money logic is duplicated. Payment integrity, idempotency, and enrollment atomicity
  are guaranteed by the same P2 code path (ADR-0014).
- A security reviewer can verify the public surface is narrow (9 endpoints, 1 module).
- The projection allowlist is testable at the integration level: a raw-response scan
  asserts no forbidden field appears (mirrors the ADR-0030 answer-key scan pattern).
- `POST /public/bookings` (P-4) and `POST /commerce/payments/webhook` are reused
  without any change (ADR-0019 and ADR-0013/0014 respectively).
- The `own`-scope check is a direct service-layer comparison, not a `role_permissions`
  row — simpler, fail-closed, but less declarative than the RBAC guard path. Acceptable
  for the self-service funnel where there is only one sensible scope.

## Alternatives considered

- **Duplicate commerce logic in public controllers**: rejected — creates a divergent money
  path, doubles the security surface, and makes idempotency guarantees harder to reason about.
- **Relax existing CRM endpoint guards to allow anonymous access**: rejected — the CRM
  endpoints expose staff-only fields (cost, margin, notes, draft content) and would require
  a post-query filter to remove them. A projection-first approach in a separate public path
  is safer.
- **GraphQL / BFF layer**: out of P5 scope; the REST `public` module achieves the same goal
  with zero new infrastructure.
