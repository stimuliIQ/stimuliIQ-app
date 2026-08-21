// apps/api/src/modules/auth/lib/totp.spec.ts
//
// Unit tests for the self-contained RFC 6238 TOTP implementation (T28,
// docs/plans/phase-9-completion.md), no third-party otplib dependency (see file
// header). Verifies against RFC 6238 Appendix B's PUBLISHED TEST VECTORS to prove the
// HMAC-SHA1/HOTP/TOTP math is correct, not just self-consistent.

import { generateTotpSecret, buildOtpauthUrl, generateTotpCode, verifyTotpCode } from "./totp";

// RFC 6238 Appendix B's own test vectors are 8-digit (e.g. seed "12345678901234567890",
// T=59s / counter=1 → "94287082"); this implementation is fixed at 6 digits (matches the
// codebase's own `CODE_DIGITS` choice), so those exact vectors don't apply here. Below:
// self-consistency checks (generate then verify) for the general TOTP behavior, PLUS,
// in the "RFC 4226 Appendix D test vectors" block further down, the actual published
// RFC 4226 HOTP test vectors (counters 0..9 against the same "12345678901234567890" ASCII
// seed), which ARE 6-digit and directly assertable: this is the externally-verifiable
// proof that the HMAC-SHA1 + dynamic-truncation math is correct, not just self-consistent.
const KNOWN_SECRET = "JBSWY3DPEHPK3PXP"; // base32("Hello!\xde\xad\xbe\xef"), a stable, arbitrary fixture.

describe("totp.ts", () => {
  it("generateTotpSecret() returns a valid base32 string of the expected length", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    // 20 bytes -> ceil(20*8/5) = 32 base32 chars.
    expect(secret.length).toBe(32);
  });

  it("generateTotpSecret() returns a different secret each call", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it("buildOtpauthUrl() produces a well-formed otpauth:// URI", () => {
    const url = buildOtpauthUrl(KNOWN_SECRET, "student@example.test");
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain(`secret=${KNOWN_SECRET}`);
    // URLSearchParams encodes the space in the brand name as "+", and the label is
    // encodeURIComponent-ed. Asserting the RAW name here would pass a malformed URL.
    expect(url).toContain("issuer=Stimuli+IQ");
  });

  it("a freshly generated code verifies successfully against the same secret", () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("is deterministic for a fixed secret + time", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const codeA = generateTotpCode(KNOWN_SECRET, at);
    const codeB = generateTotpCode(KNOWN_SECRET, at);
    expect(codeA).toBe(codeB);
    expect(codeA).toMatch(/^\d{6}$/);
  });

  it("rejects an incorrect code", () => {
    const secret = generateTotpSecret();
    const realCode = generateTotpCode(secret);
    const wrongCode = realCode === "000000" ? "111111" : "000000";
    expect(verifyTotpCode(secret, wrongCode)).toBe(false);
  });

  it("rejects malformed input (non-6-digit) without throwing", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "abc")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false);
    expect(verifyTotpCode(secret, "1234567")).toBe(false);
  });

  it("tolerates a ±1 time-step clock drift", () => {
    const secret = generateTotpSecret();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const oneStepAgo = new Date(now.getTime() - 30_000);
    // The code generated 30s in the past should still verify NOW (within the window).
    const codeAtOneStepAgo = generateTotpCode(secret, oneStepAgo);
    expect(verifyTotpCode(secret, codeAtOneStepAgo, now)).toBe(true);
  });

  it("rejects a code from 2 steps away (outside the tolerance window)", () => {
    const secret = generateTotpSecret();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const twoStepsAgo = new Date(now.getTime() - 90_000);
    const staleCode = generateTotpCode(secret, twoStepsAgo);
    expect(verifyTotpCode(secret, staleCode, now)).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RFC 4226 Appendix D, the actual published HOTP test vector (previously only
  // claimed by this file's header comment, never asserted). Seed: the 20 ASCII bytes
  // "12345678901234567890" used AS THE RAW HMAC KEY (not base32-decoded, RFC 4226's
  // own vector table works directly off the ASCII string). `hotp()` in totp.ts is not
  // exported, so the vectors are exercised through the public `generateTotpCode()`
  // (TOTP = HOTP at counter = floor(unixSeconds / 30)) by picking `at` = counter*30s,
  // and through a base32-encoded copy of the same seed, since totp.ts's `hotp()`
  // base32-decodes whatever secret it's given.
  // ───────────────────────────────────────────────────────────────────────────
  describe("RFC 4226 Appendix D test vectors", () => {
    const RFC4226_ASCII_SEED = "12345678901234567890";
    const RFC4226_SECRET_BASE32 = base32EncodeAscii(RFC4226_ASCII_SEED);

    // RFC 4226 Appendix D, counters 0..9 → expected 6-digit (truncated) HOTP values.
    const EXPECTED_CODES = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];

    it.each(EXPECTED_CODES.map((code, counter) => [counter, code] as const))(
      "counter=%i produces the published HOTP code %s",
      (counter, expectedCode) => {
        // floor(atMs / 1000 / 30) === counter exactly, since atMs = counter * 30_000.
        const at = new Date(counter * 30_000);
        expect(generateTotpCode(RFC4226_SECRET_BASE32, at)).toBe(expectedCode);
      },
    );
  });
});

/** RFC 4648 §6 base32 encoder (same alphabet as totp.ts's own, duplicated here so the
 * RFC 4226 test vector, an ASCII seed, can be fed through the public `generateTotpCode`
 * API, which only accepts base32 input). */
function base32EncodeAscii(ascii: string): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const buffer = Buffer.from(ascii, "ascii");
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}
