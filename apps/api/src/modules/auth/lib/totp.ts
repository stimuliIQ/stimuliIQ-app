// apps/api/src/modules/auth/lib/totp.ts
//
// Self-contained RFC 6238 TOTP (Time-based One-Time Password) implementation using ONLY
// `node:crypto` — NO new npm dependency (T28, docs/plans/phase-9-completion.md; the
// plan's DECISIONS section flags `otplib` + `qrcode` as "ask-before-install new deps",
// and this task has no interactive channel to obtain that approval mid-run). TOTP
// (RFC 6238, built on HOTP RFC 4226) is a small, precisely-specified algorithm — safe
// to implement directly against `crypto.createHmac` without a third-party library.
//
// QR CODE: no server-side QR image is rendered (that WOULD need the `qrcode` package).
// enroll() returns `{ secret, otpauthUrl }` — any authenticator app can consume the
// `otpauth://totp/...` URI either via a frontend-rendered QR (frontend teams commonly
// already ship a QR lib) or via manual secret entry (the standard TOTP enrollment
// fallback "can't scan? enter this code"). Tracked as a phase-9 follow-up if a
// server-rendered QR image becomes a hard requirement (needs the `qrcode` dep approved).
//
// SECURITY: the secret is a high-entropy random value (20 bytes / 160 bits, per RFC 4226
// §4 recommendation), base32-encoded (the universal authenticator-app convention).
// Codes are verified with a ±1 time-step window (90s total) to tolerate clock drift,
// using constant-time comparison to avoid timing side-channels.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SECRET_BYTES = 20; // 160 bits — RFC 4226 §4 recommended HOTP secret length.
const TIME_STEP_SECONDS = 30; // RFC 6238 default.
const CODE_DIGITS = 6;
const VERIFY_WINDOW_STEPS = 1; // ±1 step (±30s) tolerance for clock drift.

// ─────────────────────────────────────────────────────────────────────────────
// Base32 (RFC 4648 §6) — encode only (secrets are generated here, never decoded from
// arbitrary user input beyond what we ourselves encoded).
// ─────────────────────────────────────────────────────────────────────────────

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // skip non-alphabet chars defensively (e.g. spaces).
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret generation + otpauth:// URI (for authenticator app enrollment)
// ─────────────────────────────────────────────────────────────────────────────

/** Generates a new random base32-encoded TOTP secret. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/**
 * Builds the standard `otpauth://totp/...` enrollment URI (consumed by Google
 * Authenticator, Authy, 1Password, etc. either via QR scan or manual paste).
 */
export function buildOtpauthUrl(secret: string, accountLabel: string, issuer = "stimuliIQ"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(CODE_DIGITS),
    period: String(TIME_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOTP (RFC 4226) / TOTP (RFC 6238) code generation + verification
// ─────────────────────────────────────────────────────────────────────────────

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);

  return String(binCode % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

/** Generates the CURRENT TOTP code for `secret` — used by tests / any server-side display need. */
export function generateTotpCode(secret: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / TIME_STEP_SECONDS);
  return hotp(secret, counter);
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a user-supplied TOTP code against `secret`, tolerating clock drift within
 * ±VERIFY_WINDOW_STEPS time steps (±30s by default). Constant-time comparison per step.
 */
export function verifyTotpCode(secret: string, code: string, at: Date = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false; // fail closed on malformed input.
  const counter = Math.floor(at.getTime() / 1000 / TIME_STEP_SECONDS);

  for (let drift = -VERIFY_WINDOW_STEPS; drift <= VERIFY_WINDOW_STEPS; drift++) {
    if (constantTimeEquals(hotp(secret, counter + drift), code)) {
      return true;
    }
  }
  return false;
}
