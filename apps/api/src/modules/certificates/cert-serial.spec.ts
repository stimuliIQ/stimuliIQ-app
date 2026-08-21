// apps/api/src/modules/certificates/cert-serial.spec.ts
//
// Unit tests for the short human-typeable certificate serial (STMQ-YYYY-XXXX-XXXX).
// Covers generation format/alphabet, the shared normalise/detect helpers from @repo/types,
// and (statistically) uniqueness of the crypto-random half.

import {
  CERT_SERIAL_REGEX,
  generateCertSerial,
  isCertificateSerial,
  normalizeCertificateSerial,
} from "./cert-serial.util";

describe("generateCertSerial", () => {
  it("produces a canonical STMQ-YYYY-XXXX-XXXX serial", () => {
    const serial = generateCertSerial(new Date("2026-07-15T00:00:00Z"));
    expect(serial).toMatch(CERT_SERIAL_REGEX);
    expect(serial.startsWith("STMQ-2026-")).toBe(true);
  });

  it("embeds the UTC issue year", () => {
    // 2025-12-31T23:30:00Z is still 2025 in UTC (guards against a local-time off-by-one).
    const serial = generateCertSerial(new Date("2025-12-31T23:30:00Z"));
    expect(serial.startsWith("STMQ-2025-")).toBe(true);
  });

  it("only uses Crockford base32 symbols (never I, L, O, U) in the random half", () => {
    for (let i = 0; i < 200; i += 1) {
      const serial = generateCertSerial(new Date("2026-01-01T00:00:00Z"));
      const randomHalf = serial.replace("STMQ-2026-", "").replace("-", "");
      expect(randomHalf).toHaveLength(8);
      expect(/[ILOU]/.test(randomHalf)).toBe(false);
      expect(/^[0-9A-HJKMNP-TV-Z]{8}$/.test(randomHalf)).toBe(true);
    }
  });

  it("is (statistically) unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      seen.add(generateCertSerial(new Date("2026-01-01T00:00:00Z")));
    }
    // 40 bits of entropy → collisions across 5k draws are vanishingly unlikely.
    expect(seen.size).toBe(5000);
  });
});

describe("normalizeCertificateSerial", () => {
  it("upper-cases and strips spaces from serial-shaped input", () => {
    expect(normalizeCertificateSerial("  stmq-2026-7f3k-9qx2 ")).toBe("STMQ-2026-7F3K-9QX2");
    expect(normalizeCertificateSerial("stmq-2026-7f 3k-9qx2")).toBe("STMQ-2026-7F3K-9QX2");
  });

  it("leaves a case-sensitive base64url cert_uid untouched (never mangled)", () => {
    const uid = "eyJzIjoiYWJjIn0.k9Xr2mQ7vB";
    expect(normalizeCertificateSerial(uid)).toBe(uid);
  });

  it("only trims non-serial input", () => {
    expect(normalizeCertificateSerial("  abc.def  ")).toBe("abc.def");
  });
});

describe("isCertificateSerial", () => {
  it("accepts a canonical serial and rejects a cert_uid / garbage", () => {
    expect(isCertificateSerial("STMQ-2026-7F3K-9QX2")).toBe(true);
    expect(isCertificateSerial("eyJzIjoiYWJjIn0.k9Xr2mQ7vB")).toBe(false);
    // Ambiguous letters are not in the alphabet, so a serial containing them is invalid.
    expect(isCertificateSerial("STMQ-2026-ILOU-9QX2")).toBe(false);
    // Lower-case must be normalised first, the raw regex is upper-case only.
    expect(isCertificateSerial("stmq-2026-7f3k-9qx2")).toBe(false);
  });
});
