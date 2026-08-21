// Unit tests for the 2FA secret envelope-encryption primitive (Wave 6 security audit M4).
// No DB / Redis, pure crypto. Uses a fixed dev key via the env fallback (NODE_ENV=test,
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
    // are ignored by the decoder, every few runs the "tampered" string decoded to
    // the identical bytes and decryption legitimately succeeded → flaky test.)
    const ctBytes = Buffer.from(parts[3]!, "base64");
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    parts[3] = ctBytes.toString("base64");
    expect(() => decryptTwoFactorSecret(parts.join("."))).toThrow();
  });

  // The regression test for the production incident this file's header already
  // describes (M4): TWO_FACTOR_ENC_KEY was unset in production, and BEFORE
  // env.ts's own production-required check (config/env.spec.ts) was added, the app
  // booted GREEN and this only surfaced the first time a user completed 2FA
  // enrolment. Asserts the fail-closed behavior end-to-end through the public API
  // of this module (not just env.ts in isolation), whichever layer throws first
  // (env validation now, or this module's own resolveKeyMaterial() as a second line
  // of defense), calling the crypto helper in production with no key MUST throw.
  it("throws when NODE_ENV=production and TWO_FACTOR_ENC_KEY is unset (fail-closed)", () => {
    // Mutating NODE_ENV/APP_ENV on shared `process.env` would leak into whichever spec
    // file Jest runs next in this same worker process, save and restore explicitly
    // (finally-guarded) rather than relying on a later beforeAll to overwrite it.
    const savedNodeEnv = process.env.NODE_ENV;
    const savedAppEnv = process.env.APP_ENV;
    const savedTwoFactorKey = process.env.TWO_FACTOR_ENC_KEY;
    const savedCertSecret = process.env.CERT_SIGNING_SECRET;
    const savedNotificationSecret = process.env.NOTIFICATION_SIGNING_SECRET;

    try {
      __resetEnvCacheForTests();
      setMinimalEnv({
        NODE_ENV: "production",
        APP_ENV: "production",
        // The OTHER two production-required secrets must be present so the throw we
        // assert is specifically about TWO_FACTOR_ENC_KEY, not a different missing var.
        CERT_SIGNING_SECRET: "c".repeat(32),
        NOTIFICATION_SIGNING_SECRET: "d".repeat(32),
      });
      delete process.env.TWO_FACTOR_ENC_KEY;

      // env validation now rejects first, and it throws a deliberately generic message
      // ("Invalid environment configuration") after printing the per-key detail to stderr.
      // So the throw is asserted here and the KEY NAME is asserted on that output, an
      // operator needs to be told which variable is missing, and that is where it is said.
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(() => encryptTwoFactorSecret("JBSWY3DPEHPK3PXP")).toThrow();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("TWO_FACTOR_ENC_KEY"));
      } finally {
        errorSpy.mockRestore();
      }
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      process.env.APP_ENV = savedAppEnv;
      if (savedTwoFactorKey === undefined) delete process.env.TWO_FACTOR_ENC_KEY;
      else process.env.TWO_FACTOR_ENC_KEY = savedTwoFactorKey;
      if (savedCertSecret === undefined) delete process.env.CERT_SIGNING_SECRET;
      else process.env.CERT_SIGNING_SECRET = savedCertSecret;
      if (savedNotificationSecret === undefined) delete process.env.NOTIFICATION_SIGNING_SECRET;
      else process.env.NOTIFICATION_SIGNING_SECRET = savedNotificationSecret;
      __resetEnvCacheForTests();
      setMinimalEnv(); // restore the dev-key-fallback env this file's other tests rely on.
    }
  });
});
