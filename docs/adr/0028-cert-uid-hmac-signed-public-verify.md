# ADR 0028: Certificate `cert_uid` as HMAC-SHA256 signed token; public verify recomputes signature

## Status
Accepted

## Context
`docs/04 §2.11` specifies a "verifiable ID" for certificates. The verification model is
the crux of certificate forgery resistance: a naive implementation that treats `cert_uid`
as an opaque database lookup key means that anyone who can insert a row into
`certificates` (or guess a valid UUID) can produce a "valid" certificate. The system
must be resistant to both fabricated rows and guessed identifiers.

Two signing approaches were considered: symmetric HMAC (shared secret, server-only
verifier) and asymmetric RS256 (private-key signer, public-key verifier — as in
ADR-0021 for HLS delivery). The choice between them is driven by who needs to verify
and what trust boundary that implies.

For HLS video delivery (ADR-0021), RS256 is the right choice because the CDN edge
worker is an untrusted third party that needs to verify tokens without holding the
signing secret. The verifier (CDN) and the signer (our server) are different
principals.

For certificate verification, the verifier is our own public API endpoint
(`GET /verify/:certUid`). The server is both signer and verifier — there is no
untrusted third-party verifier that needs a public key. A symmetric HMAC-SHA256
secret is therefore sufficient, simpler, and avoids the complexity of RS keypair
management (PEM encoding, rotation, JWKS endpoint) for a use case that does not need
it.

The `CERT_SIGNING_SECRET` must never leave the server. It is never logged, never
returned in any response, and never included in any DTO.

## Decision

**`cert_uid` generation:**

```typescript
// cert-uid.util.ts
import { createHmac, randomBytes } from 'node:crypto';

function signCertUid(payload: {
  studentId: string;
  programId: string;
  issuedAt: string;   // ISO-8601
  nonce: string;      // randomBytes(16).toString('hex')
}, secret: string): string {
  const message = [payload.studentId, payload.programId, payload.issuedAt, payload.nonce]
    .join(':');
  return createHmac('sha256', secret).update(message).digest('hex')
    + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
}
```

The resulting `cert_uid` embeds the signed payload (base64url) alongside the HMAC
digest, allowing the verifier to extract the payload from the token itself without
a DB round-trip for the initial signature check.

**`cert_uid` verification (public `GET /verify/:certUid`):**

1. Split the token on `.` to extract `[hmacHex, payloadB64]`.
2. Decode `payloadB64` → `{ studentId, programId, issuedAt, nonce }`.
3. Recompute `expectedHmac = HMAC-SHA256(secret, studentId:programId:issuedAt:nonce)`.
4. Constant-time compare (`crypto.timingSafeEqual`) `hmacHex` vs `expectedHmac`.
5. If mismatch → 404 immediately. **No DB query is made for a token that fails
   signature verification.**
6. If match → query `certificates WHERE cert_uid = :certUid AND deleted_at IS NULL` to
   read `status`, `program`, `issuedAt`, `holderName`.
7. Return `{ valid: true|"revoked", program, issuedAt, holderName }`.

This two-step design means:
- A **fabricated `cert_uid`** (random bytes, guessed UUID) fails at step 4 — no DB
  query, no information disclosure.
- A **tampered `cert_uid`** (one flipped character) also fails at step 4.
- A **validly signed but nonexistent `cert_uid`** (the token is well-formed but the
  DB row was soft-deleted or never inserted) fails at step 6 → 404.
- A **revoked certificate** resolves at step 6 with `status='revoked'` → returns
  `valid: "revoked"` immediately (no cache window).

**Secret management:**

- `CERT_SIGNING_SECRET` must be at least 32 characters (enforced by the zod env schema
  as `z.string().min(32)`).
- In `NODE_ENV !== 'production'`: if `CERT_SIGNING_SECRET` is unset, the signer uses
  a clearly-labelled local dev constant (`'stimuliiq-dev-cert-secret-NOT-FOR-PROD'`)
  and logs a `WARN`-level message at every sign/verify call.
- In `NODE_ENV === 'production'`: if `CERT_SIGNING_SECRET` is unset, the signer
  **throws at call time** (fail-closed). The API does not fall back to the dev constant
  in production.
- Recommended generation: `openssl rand -hex 32`.

**Rate limiting on the public verify endpoint:**

`GET /verify/:certUid` is unauthenticated. A Nest `ThrottlerGuard` is applied with a
configurable threshold (env-driven, not hard-coded — per AC-H6). When exceeded the
server returns 429 with a `Retry-After` header. The M-1 security finding (missing
`Retry-After`) was fixed in the Wave 7 remediation.

## Consequences
- Certificate forgery by row fabrication is defeated: a row inserted without a valid
  `CERT_SIGNING_SECRET`-derived `cert_uid` cannot pass public verify.
- Guessing `cert_uid` is computationally infeasible (256-bit HMAC key space).
- The signing model is server-symmetric: no public key to distribute, no JWKS endpoint
  needed, no keypair rotation complexity.
- Secret rotation requires reissuing all existing certificates (their `cert_uid`s were
  signed with the old secret). This is a known trade-off; rotation tooling is a
  follow-up concern and should be coordinated with the ops team.
- The dev fallback constant means local/CI test coverage runs without setting
  `CERT_SIGNING_SECRET`, preventing accidental CI failures from missing env vars.

## Alternatives considered
- **RS256 asymmetric signing (same as ADR-0021)**: appropriate when the verifier is an
  untrusted third party who must hold a public key but not the secret. Our verifier is
  our own server — the shared-secret benefit of HMAC applies, and the added complexity
  of PEM keypair management is unnecessary. Rejected.
- **Opaque random UUID as `cert_uid` (bare DB lookup)**: simple but provides no
  forgery resistance. A fabricated row with a valid-looking UUID passes verification.
  Rejected — the whole point of signed UIDs is to make fabrication detectable without
  a trusted DB insert.
- **Including the full cert payload in the `cert_uid`** (self-contained JWT-style):
  the current design already embeds the payload in the token for inspection; adding a
  full JWT structure would impose `jsonwebtoken` / `jose` as a dependency for what is
  effectively a simpler operation. The `cert_uid` is not a JWT — it does not need `iss`,
  `aud`, `exp`, or JWS headers. Rejected — keep it minimal.
