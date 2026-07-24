# ADR 0003: RS256 JWTs with rotating, single-use refresh tokens and family reuse-detection

## Status
Accepted

## Context
`CLAUDE.md §1` mandates "JWT access (15 min) + rotating refresh (7 d)". Phase-0 risk
log (`docs/plans/phase-0.md`, open question #1) needed a concrete answer for how the
RS256 keypair is sourced for local development without committing secrets.

## Decision
- **Algorithm:** RS256 (asymmetric), via `jose`. Keys are loaded from
  `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` (`apps/api/src/modules/auth/lib/jwt-keys.ts`).
- **Local dev keypair:** `pnpm gen:keys` (`infra/scripts/gen-keys.mjs`) generates a
  2048-bit RSA keypair into the gitignored `keys/` directory, idempotently (skips if
  both files exist; `--force` to regenerate). CI calls the same script with
  ephemeral, throwaway keys per run. Real staging/prod keys are expected to come
  from a secrets manager, never from this script or committed PEM files.
- **Access token:** 15 minute TTL (`JWT_ACCESS_TTL`), httpOnly cookie (ADR-0002).
- **Refresh token:** 7 day TTL (`JWT_REFRESH_TTL`), **single-use** — each refresh
  call issues a new refresh token and invalidates the old one. The hash of the
  current refresh token is stored server-side on `sessions.refresh_hash`
  (`prisma/schema.prisma`), never the raw token.
- **Reuse detection:** if a refresh token that has already been rotated-out is
  presented again, the entire token *family* (all sessions descending from that
  login) is revoked — treated as a signal of token theft/replay.
- **Sessions** are tracked in Postgres (`sessions` table: `device`, `ip`,
  `expires_at`, `revoked_at`) and are themselves audited (see ADR-0005) for
  forensic traceability of rotation timing.

## Consequences
- Asymmetric signing means the public key can be distributed to any service that
  needs to verify tokens (future service split per `CLAUDE.md §1`'s modular-monolith
  plan) without giving that service the ability to mint tokens.
- Single-use rotation + family revocation gives strong protection against refresh
  token replay at the cost of slightly more DB writes per refresh (one read + one
  write to `sessions` per rotation) and added complexity in `token.service.ts` to
  track token lineage.
- `pnpm gen:keys` removes "where do I get a keypair" as a Phase-0 onboarding
  blocker, but means every contributor (and CI run) has a *different* keypair —
  tokens are never portable across environments by design, which is correct for
  security but means there is no "shared dev token" shortcut.
- `Session` row churn (create on login, update on every refresh rotation) is a
  known, accepted audit-log volume concern — see ADR-0005's consequences and
  `docs/phase-0-followups.md`.

## Alternatives considered
- **HS256 (symmetric)**: simpler key management (one shared secret) but requires
  every verifying service to hold the signing secret, which is unacceptable once the
  modular monolith starts splitting into services. Rejected.
- **Non-rotating refresh tokens** (one long-lived refresh token reused until
  expiry): simpler, but a single leaked refresh token would be valid for its full
  7-day lifetime with no way to detect misuse. Rejected — fails the "rotating
  refresh" requirement in `CLAUDE.md §1` outright.
- **Opaque server-side session tokens instead of JWT access tokens**: would avoid
  JWT verification entirely, but loses the stateless-verification benefit JWTs give
  for horizontal scaling of API instances. Rejected in favor of the CLAUDE.md-mandated
  JWT approach.
