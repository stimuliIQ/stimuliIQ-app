// Unit tests for the 2FA secret envelope-encryption primitive (Wave 6 security audit M4).
// No DB / Redis — pure crypto. Uses a fixed dev key via the env fallback (NODE_ENV=test,
// TWO_FACTOR_ENC_KEY unset → deterministic LOCAL dev key), so a round-trip is stable.

import { encryptTwoFactorSecret, decryptTwoFactorSecret } from "./two-factor-crypto";
import { __resetEnvCacheForTests } from "../../../config/env";
import { setMinimalEnv } from "../../../common/testing/minimal-env";

describe("two-factor-crypto (M4 encryption-at-rest)", () => {
  beforeAll(() => {
    __resetEnvCacheForTests();
    setMinimalEnv(); // NODE_ENV=test by Jest default → dev-key fallback, no throw.
  });

  it("round-trips a TOTP secret through encrypt → decrypt", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const stored = encryptTwoFactorSecret(secret);
    expect(stored).not.toBe(secret); // actually encrypted at rest
    expect(stored.startsWith("2fa1.")).toBe(true); // versioned envelope
    expect(decryptTwoFactorSecret(stored)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV) but decrypts to the same plaintext", () => {
    const secret = "KRSXG5CTMVRXEZLU";
    const a = encryptTwoFactorSecret(secret);
    const b = encryptTwoFactorSecret(secret);
    expect(a).not.toBe(b);
    expect(decryptTwoFactorSecret(a)).toBe(secret);
    expect(decryptTwoFactorSecret(b)).toBe(secret);
  });

  it("passes through a legacy plaintext secret (no versioned prefix) unchanged", () => {
    // Rows written before M4 hold the raw secret; decrypt() must keep them working.
    const legacy = "GEZDGNBVGY3TQOJQ";
    expect(decryptTwoFactorSecret(legacy)).toBe(legacy);
  });

  it("throws on a tampered ciphertext (GCM auth-tag mismatch)", () => {
    const stored = encryptTwoFactorSecret("MFRGGZDFMZTWQ2LK");
    const parts = stored.split(".");
    // Tamper with a REAL byte: flip a bit in the decoded ciphertext, then re-encode.
    // (The old version flipped the LAST base64 char, whose low bits are padding and
    // are ignored by the decoder — every few runs the "tampered" string decoded to
    // the identical bytes and decryption legitimately succeeded → flaky test.)
    const ctBytes = Buffer.from(parts[3]!, "base64");
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    parts[3] = ctBytes.toString("base64");
    expect(() => decryptTwoFactorSecret(parts.join("."))).toThrow();
  });
});
