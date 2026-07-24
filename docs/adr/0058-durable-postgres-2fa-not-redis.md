# ADR 0058: TOTP 2FA credentials stored durably in Postgres, not Redis

## Status
Accepted

## Context
`docs/go-live-checklist.md` **B9** required a password-reset flow;
`docs/plans/phase-9-completion.md` T28 bundled TOTP-based two-factor authentication for
admin roles alongside it (enrol, verify, disable, backup codes). The codebase already
uses Redis for OTP login codes (`apps/api/src/modules/auth/lib/otp-store.ts`) — a
short-lived, disposable, best-effort store — and it would have been the path of least
resistance to store 2FA secrets the same way. `docs/adr/0006` and the surrounding
provider-interface pattern establish that this codebase treats Redis strictly as a
**cache/rate-limit/OTP layer**, never a system-of-record (sessions' `refresh_hash` lives
in Postgres `sessions`, not Redis, for the same reason).

## Decision
Two-factor credentials are split across two stores by durability requirement:

- **Postgres `two_factor_credentials`** (new table, `TwoFactorStore` in
  `apps/api/src/modules/auth/lib/two-factor-store.ts`) holds the **active, ACTIVATED**
  TOTP secret and the **hashed** (sha256, same convention as `otp-store.ts`'s
  `hashCode`), single-use backup codes for every user who has completed 2FA enrolment.
  Partial-unique `(user_id) WHERE deleted_at IS NULL` allows re-enrolment after a
  soft-deleted disable. The row is **deliberately excluded from `AUDITED_MODELS`**
  (ADR-0005) — a security credential must never be before/after-snapshotted into
  `audit_logs`, mirroring the existing `password_hash` posture.
- **Redis** holds only the **enrolment-in-progress** secret (`auth:2fa:pending:<userId>`,
  10-minute TTL) — the value generated when a user starts enrolling but has not yet
  proven possession by submitting a correct TOTP code. This secret is worthless on its
  own (no backup codes, not yet activated); losing it to a Redis flush/eviction/restart
  just means "start enrolment again," an acceptable UX cost for a value that by
  definition has zero users depending on it yet.

`activate()` runs the "soft-delete any prior active row, then insert the new one, issue
fresh backup codes" sequence inside a single Prisma transaction so the partial-unique
index never clashes on re-enrolment; `consumeBackupCode()` runs its
read-check-filter-write sequence inside a transaction so two concurrent uses of the same
backup code cannot both succeed.

## Consequences
- A Redis flush, eviction under memory pressure, or a Redis outage/redeploy **cannot
  lock out an already-enrolled user** — the credential that gates their login lives in
  the same durable store as their password hash and survives exactly the same failure
  modes. This was the explicit motivating risk: 2FA is an availability-critical
  authentication factor, not a convenience cache entry.
- Enrolment-in-progress state staying in Redis costs nothing in durability (it is
  provably safe to lose) and keeps the "10-minute abandon-and-retry" window cheap and
  self-expiring, with no cleanup job needed.
- The audit-exemption for `two_factor_credentials` means CRM Admin → Audit Logs will
  never show a 2FA secret or backup-code list, even hashed — consistent with never
  wanting a credential's shape in an audit trail, but it also means 2FA
  enrol/disable/regenerate events are **not independently auditable via `audit_logs`**
  today; if that visibility is needed later, it should be a dedicated non-PII
  "2fa_enrolled"/"2fa_disabled" event row, not a snapshot of the credential itself.
- `apps/api/package.json` gains `otplib` (TOTP generation/verification) and `qrcode`
  (enrolment QR code) as approved new dependencies (`docs/plans/phase-9-completion.md`
  decision #6).

## Alternatives considered
- **Store the active secret + backup codes in Redis (same as the pending secret), with a
  long/no TTL.** Rejected — this is exactly the risk this ADR exists to avoid: Redis in
  this codebase is documented and operated as an evictable cache/session layer (session
  `refresh_hash` was deliberately placed in Postgres, not Redis, for the identical
  reason), and a 2FA lockout for every enrolled admin from a routine Redis maintenance
  event is an unacceptable availability regression for an authentication control.
- **A dedicated encrypted-at-rest secrets store (e.g. Vault) for the TOTP secret.**
  Rejected as over-scoped for this phase — no such infrastructure exists elsewhere in the
  stack (Razorpay/MSG91/Zoom credentials are all plain env vars), and Postgres already
  provides the durability guarantee this decision needs; encryption-at-rest for this
  column is a reasonable future hardening item, not a blocker for the decision of *which
  store*.
- **Keep everything (pending + active) in Redis but back it with AOF-persistence /
  durable Redis.** Rejected — it would still be a second system-of-record with its own
  backup/PITR story to build and operate, duplicating what Postgres already provides for
  every other credential-shaped column in this schema, for no benefit over just using
  Postgres directly.

## Related
Builds on the Redis-vs-Postgres durability boundary implicit in ADR-0006 (SMS OTP —
Redis-based, deliberately disposable) and the soft-delete/audit-extension machinery of
ADR-0005 (audit exemption for credential-shaped rows).
