// apps/api/src/modules/certificates/cert-uid.util.ts
//
// cert_uid signing + verification (docs/plans/phase-4.md task #4, §6 Risk #2;
// docs/04-trd-architecture.md §2.11; docs/specs/phase-4-learning-depth.md AC-I).
//
// THE FORGERY-RESISTANCE CONTRACT
// ────────────────────────────────
// A certificate's public identifier (`cert_uid`) is a SIGNED token, not a random
// opaque id. It embeds the tuple (studentId, programId, issuedAt, nonce) and an
// HMAC-SHA256 signature over that tuple, keyed by a server-only secret.
//
//   verifyCertUid() RECOMPUTES the HMAC and compares it (timing-safe) to the one
//   embedded in the token. This means:
//     • A fabricated `certificates` DB row cannot pass verification unless the
//       attacker also produced a valid signature — which requires the secret.
//     • A guessed / brute-forced uid cannot pass verification.
//     • Tampering with any field (student, program, issuedAt, nonce) or the
//       signature invalidates the token.
//
// The public verify endpoint (#8) does BOTH: verifyCertUid() (signature) AND a DB
// lookup by cert_uid to read the live status (valid | revoked) and the minimal
// display fields. Signature proves authenticity; the DB read proves it was really
// issued and is not revoked. Neither alone is sufficient.
//
// WHY HMAC-SHA256 (not RS256)?
//   Verification here is SERVER-SIDE only (unlike the video HLS URLs in ADR-0021,
//   which are verified at an untrusted CDN edge and therefore use RS256 so the
//   verifier never holds the signing key). Our verifier IS the trusted API server,
//   so a single symmetric secret is simplest and has no key-distribution downside.
//   The secret never leaves the server and is never returned in any response.
//
// SECRET HANDLING (fail-closed in production)
//   getCertSigningSecret() reads CERT_SIGNING_SECRET from the validated env.
//     • Present            → use it.
//     • Absent + NODE_ENV=production → THROW (fail closed; never silently sign with
//                            a well-known dev key in prod).
//     • Absent + non-prod   → use a clearly-marked LOCAL-ONLY dev secret + warn once.
//   The secret is never logged.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import { validateEnv } from "../../config/env";

const logger = new Logger("CertUid");

// A deliberately obvious local-only fallback so a missing secret in dev/CI does not
// block boot, while making it impossible to mistake for a real production secret.
// NEVER used when NODE_ENV=production (getCertSigningSecret throws instead).
const LOCAL_DEV_FALLBACK_SECRET =
  "LOCAL-DEV-ONLY-cert-signing-secret-not-for-production-use-0000";

let warnedAboutDevSecret = false;

/**
 * Resolves the HMAC signing secret. Fail-closed in production.
 *
 * @throws {Error} in production when CERT_SIGNING_SECRET is unset.
 */
export function getCertSigningSecret(env = validateEnv()): string {
  if (env.CERT_SIGNING_SECRET) {
    return env.CERT_SIGNING_SECRET;
  }
  if (env.NODE_ENV === "production") {
    // Fail closed — refuse to sign/verify with a guessable key in production.
    throw new Error(
      "CERT_SIGNING_SECRET is required in production. Certificate signing/verification " +
        "is disabled until it is set (see .env.example).",
    );
  }
  if (!warnedAboutDevSecret) {
    logger.warn(
      "CERT_SIGNING_SECRET is not set — using the LOCAL-ONLY dev fallback secret. " +
        "cert_uid tokens are NOT trustworthy across environments. Set a real secret for staging/prod.",
    );
    warnedAboutDevSecret = true;
  }
  return LOCAL_DEV_FALLBACK_SECRET;
}

/** The signed tuple embedded in a cert_uid. */
export interface CertUidPayload {
  /** Student profile id (holder). */
  studentId: string;
  /** Program id the certificate attests. */
  programId: string;
  /** Issuance time as epoch SECONDS (compact). */
  issuedAt: number;
  /** Per-certificate random nonce — ensures uid uniqueness + unpredictability. */
  nonce: string;
}

export interface SignCertUidInput {
  studentId: string;
  programId: string;
  /** Date, ISO string, or epoch — normalised to epoch seconds. */
  issuedAt: Date | string | number;
  /** Optional explicit nonce (tests); a random one is generated when omitted. */
  nonce?: string;
}

// Compact wire form: base64url(payloadJson) + "." + base64url(hmac)
// The payload uses short keys to keep the uid shorter in the URL.
interface WirePayload {
  s: string;
  p: string;
  i: number;
  n: string;
}

function toEpochSeconds(value: Date | string | number): number {
  if (typeof value === "number") {
    // Heuristic: treat large values as ms, otherwise as seconds.
    return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(ms)) {
    throw new Error("signCertUid: issuedAt is not a valid date");
  }
  return Math.floor(ms / 1000);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function computeSignature(bodyB64: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(bodyB64).digest();
}

/**
 * Signs (studentId, programId, issuedAt, nonce) into a URL-safe cert_uid.
 *
 * Format: `<base64url(payload)>.<base64url(hmac_sha256(payload, secret))>`
 * The returned string is safe to place in a URL path (`/verify/:certUid`) and to
 * store in `certificates.cert_uid`.
 */
export function signCertUid(input: SignCertUidInput, env = validateEnv()): string {
  const secret = getCertSigningSecret(env);
  const nonce = input.nonce ?? randomBytes(9).toString("base64url");
  const wire: WirePayload = {
    s: input.studentId,
    p: input.programId,
    i: toEpochSeconds(input.issuedAt),
    n: nonce,
  };
  const bodyB64 = b64url(Buffer.from(JSON.stringify(wire), "utf-8"));
  const sigB64 = b64url(computeSignature(bodyB64, secret));
  return `${bodyB64}.${sigB64}`;
}

export interface VerifyCertUidResult {
  valid: boolean;
  payload?: CertUidPayload;
}

/**
 * Verifies a cert_uid by RECOMPUTING the HMAC over its payload and comparing
 * (timing-safe) to the embedded signature. Never throws on malformed input —
 * returns `{ valid: false }`.
 *
 * A `true` result proves the token was produced by a holder of the signing secret
 * (i.e. this server issued it). The caller must STILL check the live DB status
 * (valid | revoked) — see the public verify endpoint (#8).
 */
export function verifyCertUid(certUid: string, env = validateEnv()): VerifyCertUidResult {
  if (typeof certUid !== "string" || certUid.length === 0) {
    return { valid: false };
  }

  // Split on the LAST dot so a stray dot in base64url (there won't be one) is safe.
  const dot = certUid.lastIndexOf(".");
  if (dot <= 0 || dot === certUid.length - 1) {
    return { valid: false };
  }
  const bodyB64 = certUid.slice(0, dot);
  const sigB64 = certUid.slice(dot + 1);

  let secret: string;
  try {
    secret = getCertSigningSecret(env);
  } catch {
    // Production without a secret — fail closed.
    return { valid: false };
  }

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return { valid: false };
  }

  const expectedSig = computeSignature(bodyB64, secret);
  if (providedSig.length !== expectedSig.length) {
    return { valid: false };
  }
  if (!timingSafeEqual(providedSig, expectedSig)) {
    return { valid: false };
  }

  // Signature is valid — decode the payload.
  let wire: WirePayload;
  try {
    const json = Buffer.from(bodyB64, "base64url").toString("utf-8");
    wire = JSON.parse(json) as WirePayload;
  } catch {
    return { valid: false };
  }
  if (
    typeof wire?.s !== "string" ||
    typeof wire?.p !== "string" ||
    typeof wire?.i !== "number" ||
    typeof wire?.n !== "string"
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    payload: { studentId: wire.s, programId: wire.p, issuedAt: wire.i, nonce: wire.n },
  };
}

/** Test-only: reset the one-time dev-secret warning latch. */
export function __resetCertUidWarningForTests(): void {
  warnedAboutDevSecret = false;
}
