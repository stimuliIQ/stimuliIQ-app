// pay-link.util unit spec, the signed-token contract (mirrors cert-uid.util's
// guarantees): round-trip validity, tamper/forgery rejection, expiry, and the
// kind discriminator that keeps cert uids and pay links mutually unusable.
import type { Env } from "../../config/env";
import { signPayLinkToken, verifyPayLinkToken, PAY_LINK_TTL_SECONDS } from "./pay-link.util";
import { signCertUid } from "../certificates/cert-uid.util";

// Minimal Env stub, signing only reads CERT_SIGNING_SECRET + NODE_ENV (same
// pattern as cert-uid.spec.ts; validateEnv() needs a full env we do not have here).
const ENV = { NODE_ENV: "test", CERT_SIGNING_SECRET: "a".repeat(40) } as Env;

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

describe("pay-link token, sign/verify round trip", () => {
  it("verifies a freshly signed token and returns its payload", () => {
    const { token, expiresAt } = signPayLinkToken({ tenantId: TENANT, orderId: ORDER }, ENV);
    const result = verifyPayLinkToken(token, ENV);
    expect(result.valid).toBe(true);
    expect(result.payload).toMatchObject({ tenantId: TENANT, orderId: ORDER });
    // Default TTL ≈ 7 days out (±5s of clock skew tolerance in the assertion).
    const expectedExp = Date.now() / 1000 + PAY_LINK_TTL_SECONDS;
    expect(Math.abs(result.payload!.expiresAt - expectedExp)).toBeLessThan(5);
    expect(expiresAt.getTime()).toBe(result.payload!.expiresAt * 1000);
  });

  it("is URL-safe (base64url, single dot separator)", () => {
    const { token } = signPayLinkToken({ tenantId: TENANT, orderId: ORDER }, ENV);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("pay-link token, rejection paths", () => {
  it("rejects a tampered payload (order id swapped)", () => {
    const { token } = signPayLinkToken({ tenantId: TENANT, orderId: ORDER }, ENV);
    const [body, sig] = token.split(".");
    const wire = JSON.parse(Buffer.from(body!, "base64url").toString("utf-8")) as { o: string };
    wire.o = "33333333-3333-4333-8333-333333333333";
    const forged = `${Buffer.from(JSON.stringify(wire), "utf-8").toString("base64url")}.${sig}`;
    expect(verifyPayLinkToken(forged, ENV).valid).toBe(false);
  });

  it("rejects an expired token and flags it as expired", () => {
    const { token } = signPayLinkToken({ tenantId: TENANT, orderId: ORDER, ttlSeconds: -60 }, ENV);
    const result = verifyPayLinkToken(token, ENV);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
  });

  it("rejects malformed input without throwing", () => {
    for (const junk of ["", "no-dot", ".", "a.", ".b", "!!!.???", "x".repeat(5000)]) {
      expect(verifyPayLinkToken(junk, ENV).valid).toBe(false);
    }
  });

  it("rejects a cert_uid replayed as a pay link (kind discriminator)", () => {
    // Same signing secret, different token kind, must never cross over.
    const certUid = signCertUid({ studentId: TENANT, programId: ORDER, issuedAt: new Date() }, ENV);
    expect(verifyPayLinkToken(certUid, ENV).valid).toBe(false);
  });
});
