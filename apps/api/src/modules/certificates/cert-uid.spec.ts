// apps/api/src/modules/certificates/cert-uid.spec.ts
//
// Unit tests for the cert_uid signing/verification utility (task #4, AC-I).
// Proves the forgery-resistance contract: recomputed-signature verification,
// tamper detection, fabricated-uid rejection, wrong-secret rejection, and
// production fail-closed behaviour.

import type { Env } from "../../config/env";
import {
  signCertUid,
  verifyCertUid,
  getCertSigningSecret,
  __resetCertUidWarningForTests,
} from "./cert-uid.util";

// Minimal Env stub, sign/verify only read CERT_SIGNING_SECRET + NODE_ENV.
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    CERT_SIGNING_SECRET: "a".repeat(40),
    ...overrides,
  } as Env;
}

const SAMPLE = {
  studentId: "11111111-1111-1111-1111-111111111111",
  programId: "22222222-2222-2222-2222-222222222222",
  issuedAt: new Date("2026-06-12T10:00:00.000Z"),
  nonce: "fixed-nonce-abc",
};

describe("cert-uid: sign/verify round-trip", () => {
  beforeEach(() => __resetCertUidWarningForTests());

  it("signs and verifies, recovering the payload", () => {
    const env = makeEnv();
    const uid = signCertUid(SAMPLE, env);
    const result = verifyCertUid(uid, env);

    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload?.studentId).toBe(SAMPLE.studentId);
    expect(result.payload?.programId).toBe(SAMPLE.programId);
    expect(result.payload?.nonce).toBe(SAMPLE.nonce);
    // issuedAt normalised to epoch seconds
    expect(result.payload?.issuedAt).toBe(Math.floor(SAMPLE.issuedAt.getTime() / 1000));
  });

  it("is URL-safe (no chars needing escaping in a path segment)", () => {
    const uid = signCertUid(SAMPLE, makeEnv());
    expect(uid).toMatch(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/);
    expect(encodeURIComponent(uid)).toBe(uid);
  });

  it("produces different uids for different nonces (uniqueness)", () => {
    const env = makeEnv();
    const a = signCertUid({ ...SAMPLE, nonce: "n1" }, env);
    const b = signCertUid({ ...SAMPLE, nonce: "n2" }, env);
    expect(a).not.toBe(b);
  });

  it("generates a random nonce when none is supplied", () => {
    const env = makeEnv();
    const a = signCertUid({ ...SAMPLE, nonce: undefined }, env);
    const b = signCertUid({ ...SAMPLE, nonce: undefined }, env);
    expect(a).not.toBe(b);
    expect(verifyCertUid(a, env).valid).toBe(true);
  });

  it("accepts ISO string and epoch issuedAt forms", () => {
    const env = makeEnv();
    const fromIso = verifyCertUid(signCertUid({ ...SAMPLE, issuedAt: "2026-06-12T10:00:00.000Z" }, env), env);
    const fromEpochMs = verifyCertUid(signCertUid({ ...SAMPLE, issuedAt: SAMPLE.issuedAt.getTime() }, env), env);
    const expected = Math.floor(SAMPLE.issuedAt.getTime() / 1000);
    expect(fromIso.payload?.issuedAt).toBe(expected);
    expect(fromEpochMs.payload?.issuedAt).toBe(expected);
  });
});

describe("cert-uid: forgery resistance", () => {
  beforeEach(() => __resetCertUidWarningForTests());

  it("rejects a tampered signature (flipped char in sig)", () => {
    const env = makeEnv();
    const uid = signCertUid(SAMPLE, env);
    const [body, sig] = uid.split(".") as [string, string];
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyCertUid(`${body}.${flipped}`, env).valid).toBe(false);
  });

  it("rejects a tampered payload (edited body, signature not recomputed)", () => {
    const env = makeEnv();
    const uid = signCertUid(SAMPLE, env);
    const [body, sig] = uid.split(".") as [string, string];
    // Decode, change the student id, re-encode, but keep the OLD signature.
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    decoded.s = "99999999-9999-9999-9999-999999999999";
    const forgedBody = Buffer.from(JSON.stringify(decoded), "utf-8").toString("base64url");
    expect(verifyCertUid(`${forgedBody}.${sig}`, env).valid).toBe(false);
  });

  it("rejects a uid signed with a different secret", () => {
    const signed = signCertUid(SAMPLE, makeEnv({ CERT_SIGNING_SECRET: "secret-one".padEnd(40, "1") }));
    const verified = verifyCertUid(signed, makeEnv({ CERT_SIGNING_SECRET: "secret-two".padEnd(40, "2") }));
    expect(verified.valid).toBe(false);
  });

  it("rejects fabricated / guessed / malformed uids", () => {
    const env = makeEnv();
    for (const bad of ["", "not-a-uid", "abc.def", "a.b.c", ".", "onlybody.", ".onlysig", "🚫.🚫"]) {
      expect(verifyCertUid(bad, env).valid).toBe(false);
    }
  });

  it("does not leak whether body or signature was wrong (both → false, no throw)", () => {
    const env = makeEnv();
    expect(() => verifyCertUid("garbage", env)).not.toThrow();
    expect(() => verifyCertUid("a".repeat(200), env)).not.toThrow();
  });
});

describe("cert-uid: secret handling (fail-closed in production)", () => {
  beforeEach(() => __resetCertUidWarningForTests());

  it("uses the provided secret when set", () => {
    expect(getCertSigningSecret(makeEnv({ CERT_SIGNING_SECRET: "x".repeat(40) }))).toBe("x".repeat(40));
  });

  it("throws in production when the secret is absent", () => {
    const env = makeEnv({ NODE_ENV: "production", CERT_SIGNING_SECRET: undefined });
    expect(() => getCertSigningSecret(env)).toThrow(/CERT_SIGNING_SECRET is required in production/);
  });

  it("verifyCertUid fails closed (no throw) in production without a secret", () => {
    const prodEnv = makeEnv({ NODE_ENV: "production", CERT_SIGNING_SECRET: undefined });
    // Even a well-formed-looking uid cannot verify without a secret.
    const uid = signCertUid(SAMPLE, makeEnv());
    expect(verifyCertUid(uid, prodEnv).valid).toBe(false);
  });

  it("falls back to a dev secret outside production when unset (dev convenience)", () => {
    const devEnv = makeEnv({ NODE_ENV: "development", CERT_SIGNING_SECRET: undefined });
    const uid = signCertUid(SAMPLE, devEnv);
    expect(verifyCertUid(uid, devEnv).valid).toBe(true);
  });
});
