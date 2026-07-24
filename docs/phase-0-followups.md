# Phase-0 follow-ups (carried into P1+)

Recorded at Phase-0 closeout (`docs/plans/phase-0.md` Wave 6) so nothing found during
the security review or left stubbed during the build gets lost going into Phase 1.
None of these blocked the Phase-0 GO decision; they are tracked here for prioritization,
not as open incidents.

## Security follow-ups (from the Wave 6 security review)

The review reached a **CONDITIONAL GO**; the High findings (H-1, H-2) and the Medium
finding M-1 were remediated before close (see `docs/adr/0005-soft-delete-audit-prisma-extensions.md`
and `docs/adr/0002-cookie-csrf-auth-transport.md` for what was fixed and why). The
remaining items below were accepted as P1+ work, not Phase-0 blockers:

| ID | Finding | Notes |
|---|---|---|
| M-4 | JWT access tokens have no `aud` (audience) claim | Add `aud` once a second service/consumer of the API's tokens exists (currently only `apps/api` itself verifies them, so there's nothing to scope the audience against yet). |
| M-5 | Inactive-account enumeration | Login/OTP error responses may let an attacker distinguish "no such account" from "account exists but inactive/suspended." Needs a uniform error response regardless of account state. |
| M-6 | No IP-dimension rate limiting | Current rate limiting (`lib/login-rate-limiter.ts`) is keyed by account/identifier; an IP-based dimension (e.g. via Redis) is needed to slow down distributed credential-stuffing across many accounts from one source. |
| L-1..L-4 | Low-severity findings from the same review | See the security-reviewer's Wave 6 report for the itemized list; group into a single P1 hardening pass rather than one-off fixes. |
| — | argon2id cost parameters are not pinned/versioned | Current params are reasonable defaults; should be pinned explicitly (memory cost, time cost, parallelism) with a documented upgrade path so future increases don't silently invalidate or mismatch existing hashes. |
| — | `TENANT_SLUG = "stimuliiq"` is hardcoded in `auth.service.ts` | Deliberate Phase-0 single-tenant simplification (see comment at `apps/api/src/modules/auth/auth.service.ts:37`). Real multi-tenant resolution (by subdomain/host or another mechanism) is required before a second tenant can exist — this is a functional gap, not a security one, but should be resolved early in whichever phase introduces multi-tenant CRM/LMS access. |

## Deferred / stubbed in Phase 0

| Item | What's deferred | Tracking |
|---|---|---|
| Playwright e2e + axe a11y audits | No e2e suite exists yet; `e2e` script is a no-op stub in every app/package. Deferred because Phase 0's app shells are too minimal to have a meaningful critical-path journey to test. | Pick up once P1/P3 add real CRUD UI and LMS surfaces. |
| Real provider keys (MSG91, Razorpay, SES/Resend, Cloudflare Stream/Mux, S3/R2) | All providers are implemented behind interfaces (`CLAUDE.md §1`) with stub/no-op behavior when env keys are absent — see `docs/adr/0006-provider-interface-pattern-sms.md` for the template. | Wire real adapters/keys phase-by-phase as each provider's feature lands (P2 payments, P3 video, P6 email/WhatsApp). |
| Preview deploys (Vercel for web/lms, Cloudflare Pages for crm, Railway/ECS for api) | CI jobs exist in `.github/workflows/ci.yml` (`deploy-preview-web/lms/crm`, `deploy-api`) but are guarded with `if: false` — defined in shape, not connected to real projects/secrets. | Flip the guards once hosting projects + secrets are provisioned. |
| Sentry DSN / OpenTelemetry OTLP endpoint | Both are initialized at API boot behind their respective env vars and no-op cleanly when absent (pino structured logging is fully active regardless). | Supply `SENTRY_DSN` / `OTEL_EXPORTER_OTLP_ENDPOINT` when an observability backend is chosen for staging/prod. |
| OTP SMS send | OTP request/verify flow (rate limiting, code generation/expiry/hashing) is fully built and tested; the actual SMS send via MSG91 is a stub that only logs the code. | See `docs/adr/0006-provider-interface-pattern-sms.md`. Not usable end-to-end in any real environment until a real `SmsProvider` adapter lands. |

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 0 are recorded as ADRs in
`docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This file is for
known gaps and planned work, not decisions.
