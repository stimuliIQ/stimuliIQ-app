// apps/api/src/modules/auth/lib/two-factor-crypto.ts
//
// Envelope encryption for the TOTP secret stored in `two_factor_credentials.secret`
// (Wave 6 security audit M4). A stolen DB dump alone must not yield usable 2FA secrets —
// the AES-256-GCM key lives only in the app environment (TWO_FACTOR_ENC_KEY), never in
// the database.
//
// FORMAT (versioned, self-describing so we can rotate the scheme later):
//   "2fa1." + base64url(iv) + "." + base64url(authTag) + "." + base64url(ciphertext)
//
// BACKWARD COMPAT: decrypt() returns any value that does NOT start with the "2fa1."
// prefix verbatim — rows written before this change hold a plaintext secret, and they
// keep verifying until the user re-enrols (at which point the row is re-encrypted). No
// migration/backfill is required; the scheme is opportunistic.
//
// KEY POSTURE (mirrors cert-uid.util.ts / CERT_SIGNING_SECRET exactly):
//   - TWO_FACTOR_ENC_KEY present            → use it.
//   - absent AND NODE_ENV !== "production"  → well-known LOCAL dev key + one loud warning.
//   - absent AND production                 → THROW (fail closed). The app already
//     boots (env var is optional); the throw happens the first time a 2FA secret is
//     read/written, which is the correct fail-closed point.
//
// SECURITY: the key and the plaintext secret are NEVER logged.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { validateEnv, isProductionEnv } from "../../../config/env";

const PREFIX = "2fa1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length.

// Clearly-marked, well-known LOCAL dev key. NEVER used in production (we throw there).
const LOCAL_DEV_KEY = "LOCAL-DEV-ONLY-2fa-encryption-key-do-not-use-in-prod";

let warnedMissingKey = false;

/** Resolves the raw key string, applying the dev-fallback / prod-fail-closed policy. */
function resolveKeyMaterial(): string {
  const env = validateEnv();
  if (env.TWO_FACTOR_ENC_KEY) return env.TWO_FACTOR_ENC_KEY;

  if (isProductionEnv(env)) {
    // Fail closed — a production deployment MUST supply a real key.
    throw new Error(
      "TWO_FACTOR_ENC_KEY is required in production to encrypt 2FA secrets at rest. " +
        "Generate one with `openssl rand -hex 32` and set it in the environment.",
    );
  }

  if (!warnedMissingKey) {
    warnedMissingKey = true;
    // console (not pino) — this util is called outside a Nest request context.
    console.warn(
      "[two-factor-crypto] TWO_FACTOR_ENC_KEY is not set. Using a WELL-KNOWN LOCAL DEV key. " +
        "2FA secrets are NOT securely encrypted. Set TWO_FACTOR_ENC_KEY before any non-local use.",
    );
  }
  return LOCAL_DEV_KEY;
}

/** Derives a stable 32-byte AES key from the configured key material. */
function derivedKey(): Buffer {
  return createHash("sha256").update(resolveKeyMaterial(), "utf8").digest();
}

/** Encrypts a plaintext TOTP secret for storage. */
export function encryptTwoFactorSecret(plaintext: string): string {
  const key = derivedKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Decrypts a stored TOTP secret. Values without the versioned prefix are treated as
 * legacy plaintext and returned verbatim (opportunistic migration — see file header).
 */
export function decryptTwoFactorSecret(stored: string): string {
  if (!stored.startsWith(`${PREFIX}.`)) {
    return stored; // legacy plaintext row, pre-M4.
  }
  const parts = stored.split(".");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted 2FA secret (expected 4 dot-separated segments).");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = derivedKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64!, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64!, "base64url")), decipher.final()]);
  return plaintext.toString("utf8");
}
