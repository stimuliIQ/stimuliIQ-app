# ADR 0050: Security hardening batch — IP rate limiting, webhook freshness/monotonicity, JWT `aud`, enumeration resistance, pinned argon2id

## Status
Accepted

## Context
P0–P6 security reviews accepted several Medium/Low findings for their respective gates but
flagged them for closure before scale: P0 M-6 (no IP-dimension rate limiting), P6 M-3 (webhook
lacks per-IP throttle, signature-freshness window, and a guaranteed-monotonic bounce→suppression
transition), and standing P0 carried items (JWT `aud` claim absent, argon2id cost parameters
unpinned, inactive-account/login enumeration). P7's WS-E (AC-57 through AC-60, plus the carried
JWT/argon2/enumeration items) closes these in one grouped batch rather than piecemeal.

## Decision
- **Redis-backed per-IP rate limiting**, added as a dimension alongside the existing
  per-account/per-message-id limiters. **Auth endpoints fail closed** on a Redis error — if the
  rate-limit store is unreachable, the request is rejected rather than allowed through
  unthrottled, closing the distributed credential-stuffing gap named in P0 M-6 (a single source
  IP spreading attempts across many target accounts). **Webhook endpoints fail open** on a Redis
  error — a rate-limiter outage must not become a payment/delivery-webhook outage; the limiter
  only caps abusive volume when actually available (AC-58).
- **Webhook signature-freshness window**: alongside the existing HMAC verification, the webhook
  handler checks the signature timestamp against a configurable max age; a validly-signed but
  stale payload is rejected 401 `STALE_SIGNATURE` even though cryptographically valid (AC-59),
  closing the indefinite-replay window. The window is generous (minutes, not seconds) and
  configurable, so legitimately-delayed provider retries are not falsely rejected.
- **Monotonic, idempotent bounce→suppression transition**: the webhook handler compares an
  incoming bounce event's timestamp against the current `notification_suppressions` state before
  writing; an out-of-order (older) event arriving after a newer one is a no-op, never a
  duplicate row or a regression of already-applied state (AC-60).
- **JWT `aud` claim**: access/refresh tokens now carry an explicit `aud` claim identifying this
  API; verification rejects tokens minted for a different audience — closing the carried P0
  followups M-4 item.
- **Login enumeration-resistance**: the login path pads response timing for "unknown email" and
  "wrong password" to the same constant-time envelope as a genuine argon2id verify (an argon2
  timing pad) — an attacker cannot distinguish account non-existence from a wrong-password
  attempt via a response-time side channel, closing the carried P0 followups M-5 item.
- **Pinned argon2id cost parameters**: memory/time/parallelism costs are pinned to explicit
  constants rather than left at library defaults, which can silently change across a dependency
  bump — closing the carried "argon2id cost parameters not pinned" item.

## Consequences
- Distributed credential-stuffing spread across many accounts from a single source IP is now
  throttled — previously only account-keyed limiting existed, which this specific attack shape
  evaded.
- Webhook abuse is capped without creating a new availability risk for legitimate provider
  traffic — the fail-open posture is a deliberate asymmetry versus the fail-closed auth posture.
- Replayed webhook payloads now have a bounded validity window instead of indefinite validity.
- A token minted for a different intended audience is rejected at verification time, closing a
  latent gap ahead of any future service-split.
- Enumeration-resistant login timing closes an information-disclosure vector that response-time
  analysis could otherwise exploit.
- Password-hash cost changes are now an explicit, reviewed decision (a constant in code) rather
  than an incidental side effect of a dependency bump.

## Alternatives considered
- **Account-only rate limiting (status quo).** Rejected — does not stop a single IP from
  spreading attempts across many accounts, the exact gap P0 M-6 named.
- **Fail-closed webhook rate limiting** (matching the auth posture). Rejected — a Redis outage
  would then block real payment/delivery webhooks, converting an availability risk (limiter
  down) into a business-critical outage (payments unverifiable); fail-open is the deliberate
  choice here.
- **A single shared replay-rejection window** reused across signature validity and other webhook
  checks. Rejected in favor of a dedicated, independently configurable freshness window, so
  operators can tune it generously without touching unrelated webhook logic (per the spec's
  legitimate-delayed-retry edge case).
- **Rely on HMAC signature validity alone as sufficient webhook protection.** Rejected — HMAC
  proves authenticity, not recency or volume-boundedness; both gaps are independently closable
  and were explicitly named in P6 M-3.

## Related
Closes P0 followups M-4/M-5/M-6 and P6 followups M-3.
