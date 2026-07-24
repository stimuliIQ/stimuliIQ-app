// apps/api/src/modules/certificates/cert-serial.util.ts
//
// The SHORT, human-typeable certificate serial (STMQ-YYYY-XXXX-XXXX): generation +
// format detection/normalisation. See ADR-0061.
//
// WHY A SECOND IDENTIFIER (next to cert_uid)?
//   cert_uid is a long, HMAC-signed token — unguessable by design, perfect for the QR
//   code and the /verify link, but impossible for a human to type. The serial is the
//   opposite trade-off: short enough to read off a printed certificate and type in, at
//   the cost of being (only) rate-limit-protected rather than signature-protected.
//
// FORMAT + ENTROPY
//   STMQ-<issueYear>-XXXX-XXXX, where the 8 X's are Crockford base32 (alphabet excludes
//   the visually ambiguous I, L, O, U). 8 chars × 5 bits = 40 bits of entropy in the
//   random half (~1.1 × 10^12), drawn from crypto.randomBytes — not enumerable in
//   practice, especially behind the per-IP verify rate limiter.
//
// SOURCE-OF-TRUTH NOTE
//   The canonical regex + normalise/detect helpers are ALSO defined in @repo/types
//   (CERT_SERIAL_REGEX, normalizeCertificateSerial, isCertificateSerial) for the web
//   `/verify` entry form. They are re-declared here (not imported) ON PURPOSE: the API's
//   Jest runs CJS and never loads @repo/types at runtime (every import there is
//   type-only and erased), so a runtime value import from @repo/types would break the
//   whole API unit suite. Keep the two definitions in lockstep — the format is fixed by
//   ADR-0061 and changing it would be a migration-level decision, so drift is unlikely.

import { randomBytes } from "node:crypto";

/** Crockford base32 alphabet — excludes I, L, O, U (5 bits per symbol). */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Number of random Crockford symbols in a serial (8 → ~40 bits). */
const RANDOM_SYMBOLS = 8;

/**
 * Canonical serial regex: STMQ-YYYY-XXXX-XXXX (upper-case, grouped 4-4).
 * MUST match @repo/types' CERT_SERIAL_REGEX.
 */
export const CERT_SERIAL_REGEX = /^STMQ-\d{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** True when the (already-normalised) input matches the canonical serial format. */
export function isCertificateSerial(input: string): boolean {
  return CERT_SERIAL_REGEX.test(input);
}

/**
 * Normalise raw user input toward the canonical serial form: trim, upper-case, and strip
 * spaces — but ONLY for serial-shaped input, so a case-sensitive base64url `certUid` is
 * never mangled. MUST match @repo/types' normalizeCertificateSerial.
 */
export function normalizeCertificateSerial(input: string): string {
  const trimmed = input.trim();
  if (/^stmq-/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, "").toUpperCase();
  }
  return trimmed;
}

/**
 * Generate one random Crockford-base32 run of `count` symbols using crypto-strong
 * randomness. Each byte is masked to its low 5 bits and indexed into the 32-symbol
 * alphabet (uniform, no modulo bias).
 */
function randomCrockford(count: number): string {
  const bytes = randomBytes(count);
  let out = "";
  for (let i = 0; i < count; i += 1) {
    out += CROCKFORD_ALPHABET[bytes[i]! & 0b11111];
  }
  return out;
}

/**
 * Mint a certificate serial: `STMQ-<YYYY>-XXXX-XXXX`.
 *
 * The year is taken (in UTC) from the issuance date so the serial carries a
 * human-meaningful cohort marker. The two 4-symbol groups are one 8-symbol random run
 * split for readability. Uniqueness is guaranteed by the DB unique index on
 * `certificates.serial`; callers should pre-check via CertificatesRepository.serialExists
 * and/or rely on the constraint as the backstop (collisions at 40 bits are ~1e-12).
 *
 * @param issuedAt issuance timestamp (used only for the YYYY segment).
 */
export function generateCertSerial(issuedAt: Date = new Date()): string {
  const year = issuedAt.getUTCFullYear();
  const run = randomCrockford(RANDOM_SYMBOLS);
  const serial = `STMQ-${year}-${run.slice(0, 4)}-${run.slice(4)}`;
  // istanbul ignore next — unreachable unless the alphabet/format drifts.
  if (!isCertificateSerial(serial)) {
    throw new Error("generateCertSerial produced a non-canonical serial (format drift).");
  }
  return serial;
}
