# ADR 0061: Short human-typeable certificate serial (`STMQ-YYYY-XXXX-XXXX`)

## Status
Accepted

## Context
A certificate's public identifier (`certificates.cert_uid`) is a long, HMAC-signed token
— `base64url(payload).base64url(sig)`, ~120+ characters (see ADR / cert-uid.util.ts,
`docs/specs/phase-4-learning-depth.md` AC-H). It is unguessable and tamper-evident: the
public `GET /verify/:certUid` endpoint RECOMPUTES the signature before any DB access, so a
fabricated or guessed uid 404s. That makes it ideal for the QR code and the verify link.

It is useless as something a **human types**. The public verify page's entry form already
carried the placeholder `STMQ-2026-XXXX-XXXX`, but no such short ID was ever generated —
the only identifier was the long token. Someone holding a printed certificate could scan
its QR but could not verify it by typing an ID.

## Decision
Add a SECOND public identifier, `certificates.serial`, in the format
`STMQ-<issueYear>-XXXX-XXXX` where the 8 `X`s are **Crockford base32** (alphabet
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, excluding the visually ambiguous `I L O U`). Drawn
from `crypto.randomBytes`, the random half carries ~40 bits of entropy (~1.1 × 10¹²).

- **Globally unique** (`certificates_serial_key`), across ALL rows including soft-deleted
  ones; reissue mints a **fresh** serial, so an old one is never reused.
- The public `GET /verify/:handle` and `.../download` endpoints accept **either** the long
  `cert_uid` **or** the short serial. `CertificatesService` detects the format
  (`isCertificateSerial` after `normalizeCertificateSerial`) and routes:
  - `cert_uid` → recompute HMAC first (unchanged forgery-resistance), then DB lookup.
  - `serial` → **direct DB lookup, no signature** (that is what makes it short).
- The serial is printed on the certificate PDF next to the verify URL; the QR/link keep
  using `cert_uid`.

### Security rationale for an UNSIGNED identifier
The serial is deliberately not signed. Its safety rests on two things:
1. **Entropy** — 40 random bits make enumeration impractical.
2. **The existing per-IP rate limiter** on the public verify endpoint (`VerifyRateLimiter`),
   which already gated `cert_uid` verification.

Crucially, the serial path **returns nothing the cert_uid path doesn't**. The public
`VerifyResult` DTO stays locked to exactly 5 fields (AC-H7: `valid, status, program,
issuedAt, holderName` — no PII beyond holder name, no internal IDs). The serial is **not**
added to that response; the web verify page shows it by reading the ID the visitor typed
(the route param), so the deliberately-hardened `VerifyResult` contract, its compile-time
assertions, and its runtime key-scan test are untouched. A successful guess therefore
leaks only the same semi-public facts already printed on the physical certificate.

### Alternatives rejected
- **Sequential number** (`STMQ-2026-000123`) — shortest, but fully enumerable: an attacker
  could harvest `(name, program, date)` for every certificate by counting up. Rejected on
  DPDP/PII grounds.
- **Signing the serial** — would defeat the entire point (a signature is long).
- **Replacing `cert_uid` with the serial** — loses tamper-evidence for the QR/link path.

### Shared format definition
The canonical regex + `normalizeCertificateSerial`/`isCertificateSerial` live in
`@repo/types` for the web entry form. They are **re-declared** in
`apps/api/src/modules/certificates/cert-serial.util.ts` (not imported) because the API's
Jest runs CJS and never loads `@repo/types` at runtime — every import there is type-only
and erased, so a runtime value import would break the whole API unit suite. The two copies
are documented to stay in lockstep; the format is fixed by this ADR, so drift is unlikely.

## Consequences
- Migration `20260715090000_certificate_serial` adds the column, **backfills** every
  existing certificate with a unique serial (PL/pgSQL, `random()` — a one-time backfill of
  existing data, not a security boundary), then enforces `NOT NULL` + `UNIQUE`.
- `serial` is added to the authenticated DTOs (`CertificateListItem`, `CertificateDetail`,
  `CertificateCrmDetail`, `EligibilityListItem`) and to CRM certificate search. It is NOT
  added to the public `VerifyResult`.
- Issuance/reissue pre-check `serialExists()` before rendering the PDF; the DB unique index
  is the authoritative backstop (a collision at 40 bits is ~1e-12).
