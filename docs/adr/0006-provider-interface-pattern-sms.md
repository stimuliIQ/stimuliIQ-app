# ADR 0006: SmsProvider interface with a stub MSG91 adapter in Phase 0

## Status
Accepted

## Context
`CLAUDE.md §1`/rule §3.7 requires that every external vendor call go through a
provider interface, never calling a vendor SDK directly from a feature module —
specifically naming MSG91 as the SMS/OTP provider for India. Phase-0 scope
(`docs/plans/phase-0.md` task #8, "STUBBED" table) only required the OTP
request/verify *flow* to work end-to-end; the actual SMS *send* was explicitly
deferred since no MSG91 account/keys are needed to prove the auth/RBAC vertical
slice.

## Decision
`apps/api/src/modules/auth/providers/sms/sms-provider.interface.ts` defines the
`SmsProvider` interface; `msg91-sms.provider.ts` implements it as a **stub** — it
generates and logs the OTP code (via `lib/otp-store.ts`) but does not place a real
HTTP call to MSG91. `MSG91_AUTH_KEY` / `MSG91_SENDER` / `MSG91_TEMPLATE_ID` are
present in `.env.example`, commented out, with a note that the feature behind them
no-ops cleanly when absent. The auth module depends on the `SmsProvider` interface
type, not on the MSG91 adapter concretely, so swapping in a real implementation (or
a different provider entirely) later requires no change to `auth.service.ts`.

## Consequences
- The OTP login/verification flow (rate limiting, code generation, expiry, hashing)
  is fully implemented and tested without requiring a paid MSG91 account during
  Phase-0 development or in CI.
- Wiring a real send later is a single new class implementing `SmsProvider` plus an
  env-driven provider selection — no auth-module changes needed, matching the intent
  of `CLAUDE.md §1`'s provider-interface rule.
- Until that real adapter lands, OTP login is **not usable in any real environment**
  (no SMS is actually sent) — this must be called out clearly to anyone trying to
  demo OTP login outside of reading the logged code, and is tracked in
  `docs/phase-0-followups.md` as a blocking item before OTP can be user-facing.
- The same pattern (interface + stub adapter, real keys deferred) is the template
  every other provider in `CLAUDE.md §1` (Payment, Mail, WhatsApp, Video, LiveClass,
  Storage) should follow as each lands in its respective phase (P2/P3/P6).

## Alternatives considered
- **Calling the MSG91 SDK directly from the auth module, gated by an env check**:
  faster to write but violates `CLAUDE.md §3.7` outright and makes a future provider
  swap (or adding a second SMS provider for failover) a multi-file change instead of
  a one-class addition. Rejected.
- **Skipping OTP entirely until MSG91 keys exist**: would have left the OTP
  request/verify contract (`@repo/types` DTOs, controller routes, rate limiting)
  unbuilt and untested going into P1+, increasing later integration risk. Rejected —
  building the full flow against a stub now and swapping the adapter later is lower
  risk than building flow and provider together under time pressure in a later phase.
