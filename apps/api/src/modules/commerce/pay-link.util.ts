// apps/api/src/modules/commerce/pay-link.util.ts
//
// Payment-link token signing + verification (lifecycle-redesign: "send the student
// a link to pay"). Mirrors the cert_uid contract (../certificates/cert-uid.util.ts)
// exactly — a pay link is a SIGNED token embedding (tenantId, orderId, expiry) plus
// an HMAC-SHA256 signature keyed by the server-only signing secret:
//
//   • The token IS the authorization: whoever holds a valid, unexpired token may
//     view the order summary and complete Razorpay checkout for THAT order only.
//     No session/login is required (the recipient is a prospective student who may
//     not have credentials yet — LMS provisioning happens ON enrollment, i.e. after
//     this very payment).
//   • Forgery requires the signing secret; tampering with any field invalidates it.
//   • The payload carries a `k: "pay"` kind discriminator so a cert_uid can never
//     be replayed as a pay link (and vice versa) despite sharing the secret.
//   • Expiry is embedded and verified server-side — a leaked old link goes dead on
//     its own. The public endpoints ALSO re-check the live order status (created →
//     payable; paid/failed/refunded → 410-style rejection), mirroring how cert
//     verify pairs signature proof with a live DB read.
//
// Secret: reuses CERT_SIGNING_SECRET via getCertSigningSecret() (same fail-closed-
// in-production posture; dev fallback warns). A dedicated PAY_LINK_SECRET was
// considered and rejected: one more mandatory prod secret for no isolation gain —
// the `k` discriminator already partitions the token space.

import { createHmac, timingSafeEqual } from "node:crypto";
import { validateEnv } from "../../config/env";
import { getCertSigningSecret } from "../certificates/cert-uid.util";

/** Default pay-link lifetime: 7 days — long enough for a fee decision, short enough to bound leak exposure. */
export const PAY_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface PayLinkPayload {
  tenantId: string;
  orderId: string;
  /** Expiry as epoch SECONDS. */
  expiresAt: number;
}

// Compact wire form: base64url(payloadJson) + "." + base64url(hmac)
interface WirePayload {
  k: "pay";
  t: string;
  o: string;
  e: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function computeSignature(bodyB64: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(bodyB64).digest();
}

/** Signs (tenantId, orderId, expiry) into a URL-safe pay-link token. */
export function signPayLinkToken(
  input: { tenantId: string; orderId: string; ttlSeconds?: number },
  env = validateEnv(),
): { token: string; expiresAt: Date } {
  const secret = getCertSigningSecret(env);
  const expiresAtSec = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? PAY_LINK_TTL_SECONDS);
  const wire: WirePayload = { k: "pay", t: input.tenantId, o: input.orderId, e: expiresAtSec };
  const bodyB64 = b64url(Buffer.from(JSON.stringify(wire), "utf-8"));
  const sigB64 = b64url(computeSignature(bodyB64, secret));
  return { token: `${bodyB64}.${sigB64}`, expiresAt: new Date(expiresAtSec * 1000) };
}

export interface VerifyPayLinkResult {
  valid: boolean;
  /** Set when valid=false because the signature checked out but the token expired. */
  expired?: boolean;
  payload?: PayLinkPayload;
}

/**
 * Verifies a pay-link token: recomputes the HMAC (timing-safe compare), checks the
 * kind discriminator and the embedded expiry. Never throws on malformed input.
 */
export function verifyPayLinkToken(token: string, env = validateEnv()): VerifyPayLinkResult {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { valid: false };
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { valid: false };
  }
  const bodyB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let secret: string;
  try {
    secret = getCertSigningSecret(env);
  } catch {
    return { valid: false };
  }

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = computeSignature(bodyB64, secret);
    provided = Buffer.from(sigB64, "base64url");
  } catch {
    return { valid: false };
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { valid: false };
  }

  let wire: WirePayload;
  try {
    wire = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf-8")) as WirePayload;
  } catch {
    return { valid: false };
  }
  if (
    wire.k !== "pay" ||
    typeof wire.t !== "string" ||
    typeof wire.o !== "string" ||
    typeof wire.e !== "number"
  ) {
    return { valid: false };
  }

  const payload: PayLinkPayload = { tenantId: wire.t, orderId: wire.o, expiresAt: wire.e };
  if (wire.e * 1000 < Date.now()) {
    return { valid: false, expired: true, payload };
  }
  return { valid: true, payload };
}
