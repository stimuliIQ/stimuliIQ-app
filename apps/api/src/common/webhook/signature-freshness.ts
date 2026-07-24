// apps/api/src/common/webhook/signature-freshness.ts
//
// Shared "signature-timestamp freshness window" check (Phase-6 followups M-3 / Phase-7
// Wave 2 security hardening batch A, item 2a, AC-59): "A webhook payload with a valid
// HMAC signature but a signature timestamp older than a configured maximum age ... is
// rejected even though the signature itself is cryptographically valid — closing the
// indefinite-replay window."
//
// This does NOT replace HMAC verification — it runs IN ADDITION, after the signature has
// already been verified, using a timestamp that is itself part of the signed content (so
// an attacker cannot forge a "fresh" timestamp without also forging a valid signature).
// Used by:
//   - CampaignWebhookController (email channel): Resend/Svix `svix-timestamp` header —
//     part of the Svix-signed content (`id.timestamp.body`), so tampering breaks the
//     signature.
//   - WebhookController (commerce/Razorpay): the payload's own `created_at` field is
//     inside the HMAC-signed raw body, so tampering with it also breaks the signature.
//     Razorpay's webhook signature scheme has no dedicated timestamp HEADER (unlike
//     Svix) — this is a documented limitation; when the field is absent the check is
//     skipped (fail-open on ABSENCE, not on staleness) rather than rejecting webhooks
//     from Razorpay payload shapes that omit it.
//   - WhatsApp Cloud API webhooks (Meta) have NO signed timestamp at all in their
//     X-Hub-Signature-256 scheme — freshness cannot be enforced for that channel. This
//     is a documented, unavoidable limitation of the vendor's webhook design, not an
//     oversight (see whatsapp-provider.interface.ts).

/**
 * Returns true if `timestampSeconds` (a Unix epoch timestamp, in SECONDS) is within
 * `maxAgeSeconds` of `now`. Also rejects timestamps more than `maxAgeSeconds` in the
 * FUTURE (clock-skew tolerance is the same window in both directions) — a signature
 * claiming to be from the future is just as suspicious as a stale replay.
 */
export function isWithinSignatureFreshnessWindow(
  timestampSeconds: number,
  maxAgeSeconds: number,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = now / 1000;
  const ageSeconds = Math.abs(nowSeconds - timestampSeconds);
  return ageSeconds <= maxAgeSeconds;
}
