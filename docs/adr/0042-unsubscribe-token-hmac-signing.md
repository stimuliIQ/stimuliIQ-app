# ADR 0042: Unsubscribe token as HMAC-SHA256 with constant-time verify, fail-closed signing secret

## Status
Accepted

## Context
P6's public unsubscribe flow (`POST /unsubscribe/:token`) must let a recipient opt out of
marketing communications **without authentication** (India DPDP compliance — a one-click
unsubscribe that doesn't require logging in, AC-22). This is a new unauthenticated,
enumerable-looking public surface: an attacker who could forge or predict a token could
either (a) suppress an arbitrary user's communications (nuisance) or (b) recover a user's
identity/email from the token itself (privacy leak).

The codebase already has a signed-token precedent: `cert_uid` (ADR-0028) is an
HMAC-SHA256-signed public verification token where the public verify endpoint recomputes the
signature rather than trusting a stored value.

## Decision
The unsubscribe token is `HMAC-SHA256(NOTIFICATION_SIGNING_SECRET, userId + channel + nonce)`,
following the `cert_uid` pattern (ADR-0028):

- The token is generated server-side when a marketing/transactional email/WhatsApp is sent;
  it encodes the user id, channel, and a nonce, then is HMAC-signed. The **raw user id and
  email are not recoverable from the token** without the signing secret (AC-21, AC-77) — this
  is asserted by a test that base64-decodes the token and confirms no plaintext PII is
  present.
- `POST /unsubscribe/:token` **recomputes** the HMAC over the decoded payload and compares it
  to the token's signature using a **constant-time comparison** (`crypto.timingSafeEqual`),
  not `===` string comparison — a timing side-channel on signature comparison would let an
  attacker forge a valid token byte-by-byte.
- A tampered token (one flipped character) fails the recomputed-signature check and returns
  400 `INVALID_TOKEN` with **no information about the targeted user** exposed and no
  suppression row created (AC-24).
- **`NOTIFICATION_SIGNING_SECRET` is fail-closed everywhere except `NODE_ENV=test`.** Unlike
  `CERT_SIGNING_SECRET` (ADR-0028), which allows a labelled local-only fallback constant with
  a WARN log in dev, the notification signing secret has **no shared dev/local fallback
  outside the test environment** — it must be explicitly set (e.g. via `.env`) even in local
  development. This was a security-review remediation (M-2, `docs/phase-6-followups.md`):
  the original implementation used a shared dev constant that was reachable outside
  `NODE_ENV=test`, meaning any environment that forgot to set the secret would silently sign
  (and verify) tokens with a publicly-known value.

## Consequences
- Unsubscribe links are safe to email to real recipients without leaking their identity to
  anyone who intercepts or forwards the URL.
- Local development requires generating a `NOTIFICATION_SIGNING_SECRET` (e.g.
  `openssl rand -hex 32`) before the unsubscribe flow can be exercised — there is
  intentionally no convenience fallback outside automated tests, closing the gap that the
  `CERT_SIGNING_SECRET` dev-fallback pattern left open.
- `NODE_ENV=test` retains a fixed test secret so the unit/integration suites don't require
  secret provisioning in CI — this is the one carved-out exception and is not reachable in
  any deployed environment.
- Constant-time comparison adds negligible overhead and closes a class of timing-oracle
  attacks that a naive string-equality check would leave open.

## Alternatives considered
- **Reuse `CERT_SIGNING_SECRET` for unsubscribe tokens.** Rejected — mixing the trust domains
  of certificate verification (semi-public, low-abuse-value if forged) and unsubscribe
  (privacy-sensitive, PII-adjacent) under one secret means rotating one for a compromise
  investigation forces rotating the other. Separate secrets, same signing pattern.
- **Allow a dev-fallback constant like `CERT_SIGNING_SECRET` does.** Rejected after security
  review (M-2) — the fallback was found reachable outside `NODE_ENV=test` in the original
  implementation, which is precisely the fail-open gap this ADR closes. `CERT_SIGNING_SECRET`'s
  dev-fallback pattern is not extended to this new secret.
- **String-equality (`===`) signature comparison.** Rejected — vulnerable to a timing
  side-channel that leaks how many leading bytes of a guessed signature are correct,
  eventually allowing signature forgery without the secret.
- **Store a random opaque token per suppression request instead of an HMAC.** Rejected — an
  opaque token requires a DB round-trip (and a table) just to validate a token before any
  suppression logic runs, and doesn't eliminate the need for a signing/lookup secret; the
  HMAC approach validates in-request with no extra table, consistent with the `cert_uid`
  precedent.

## Related
Follows the pattern of ADR-0028 (`cert_uid` HMAC-SHA256 signed public verify), with a
stricter (no dev-fallback) fail-closed posture per the P6 security-review remediation M-2.
