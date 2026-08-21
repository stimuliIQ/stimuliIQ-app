// apps/api/src/modules/notifications/providers/mail/noop-mail.provider.ts
//
// Test / sandbox double for MailProvider (Phase 6, docs/plans/phase-6.md §2,
// docs/specs/phase-6-engagement.md AC-12, LOCK-D2).
//
// Selected when MAIL_PROVIDER=noop (or unset) in non-production environments.
// In production, the MailProviderModule factory refuses to bind this adapter —
// it throws a boot-time error (fail-closed, AC-13) instead.
//
// ─── BEHAVIOUR ────────────────────────────────────────────────────────────────
//
//   send(input):
//     Logs the recipient + subject (NO secret in log output). Returns a
//     synthetic providerMessageId of the form "noop-mail-<uuid>" — deterministic
//     enough for tests to assert the plumbing; different per call so tests that
//     compare IDs work correctly.
//     Makes ZERO network calls. This is correct and intentional.
//
//   verifyWebhookSignature(input):
//     Performs a real HMAC-SHA256 verification using the `secret` field passed
//     in the input (which in tests is a test-only constant). This lets the test
//     suite derive valid and invalid signatures deterministically:
//
//       const validSig = NoopMailProvider.makeSvixSignature(id, ts, body, secret);
//       // pass that as the svixSignature → verifyWebhookSignature returns true
//
//     When the input.secret is an empty string, returns false (fail-closed).
//     NEVER uses a hardcoded prod secret.
//
// ─── SECURITY NOTE ────────────────────────────────────────────────────────────
//
//   This provider MUST NEVER be used in production. The MailProviderModule
//   factory enforces this: in production with MAIL_PROVIDER=noop it throws at
//   boot rather than silently accepting all sends.
//
// ─── USAGE IN UNIT TESTS ──────────────────────────────────────────────────────
//
//   const noop = new NoopMailProvider();
//   const module = await Test.createTestingModule({
//     providers: [
//       NotificationsService,
//       { provide: MAIL_PROVIDER, useValue: noop },
//     ],
//   }).compile();
//
//   // Derive a valid signature for webhook tests:
//   const raw   = '{"type":"email.delivered","data":{"email_id":"noop-mail-001"}}';
//   const msgId = 'msg_01jwrz';
//   const ts    = String(Math.floor(Date.now() / 1000));
//   const sig   = NoopMailProvider.makeSvixSignature(msgId, ts, raw, 'my-test-secret');
//   // → pass sig as the svixSignature in VerifyMailWebhookInput

import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  MailProvider,
  SendMailInput,
  SendMailResult,
  VerifyMailWebhookInput,
} from "./mail-provider.interface";

// Exported so tests can import the constant and assert it is NOT present in results.
export const NOOP_MAIL_ID_PREFIX = "noop-mail-";

@Injectable()
export class NoopMailProvider implements MailProvider {
  private readonly logger = new Logger(NoopMailProvider.name);

  constructor() {
    this.logger.warn(
      "[NoopMailProvider] Running with the no-op/test mail provider. " +
        "No emails will be sent. Do NOT use this in production. " +
        "Set MAIL_PROVIDER=resend with RESEND_API_KEY + MAIL_FROM for staging/prod.",
    );
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    // Log to + subject only — never the HTML body (may contain personal data).
    this.logger.log(
      `[NoopMailProvider] send: to=${input.to} subject="${input.subject}" ` +
        `tags=${JSON.stringify(input.tags ?? [])} ` +
        // Attachment NAMES only — never the bytes, and never a byte count that would
        // fingerprint the document. Enough to confirm the offer letter was attached.
        `attachments=${JSON.stringify((input.attachments ?? []).map((a) => a.filename))} (no network call)`,
    );

    const providerMessageId = `${NOOP_MAIL_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return { providerMessageId };
  }

  verifyWebhookSignature(input: VerifyMailWebhookInput): boolean {
    if (!input.secret) {
      this.logger.warn(
        "[NoopMailProvider] verifyWebhookSignature: secret is absent, returning false (fail-closed).",
      );
      return false;
    }

    try {
      const expectedSig = NoopMailProvider.makeSvixSignature(
        input.svixId,
        input.svixTimestamp,
        input.rawBody,
        input.secret,
      );
      // Parse incoming svixSignature — may be "v1,<base64>" or multiple comma-separated sigs.
      return NoopMailProvider.compareSvixSignatures(input.svixSignature, expectedSig);
    } catch {
      this.logger.warn("[NoopMailProvider] verifyWebhookSignature: error during verification, returning false.");
      return false;
    }
  }

  // ─── Static test helpers ─────────────────────────────────────────────────────
  //
  // These are TEST-ONLY utilities. They do NOT belong on the MailProvider interface.
  // Use them in test suites to derive valid/invalid webhook signatures without needing
  // a real Resend endpoint.

  /**
   * Computes the Svix HMAC-SHA256 signature for a webhook payload.
   *
   * Svix signed message format:
   *   <msgId>.<timestamp>.<rawBody>
   * The HMAC is computed over this string with the webhook signing secret (base64-decoded).
   * The output is base64url-encoded. Resend includes it as "v1,<base64output>" in the
   * svix-signature header (may have multiple space-separated versions).
   *
   * Usage in tests:
   *   const sig = NoopMailProvider.makeSvixSignature(msgId, ts, body, 'whsec_...');
   *   // pass "v1," + sig as svixSignature, msgId as svixId, ts as svixTimestamp
   */
  static makeSvixSignature(msgId: string, timestamp: string, rawBody: string, secret: string): string {
    // Svix secrets are prefixed "whsec_" and base64-encoded. Strip prefix if present.
    const secretClean = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const secretBuf = Buffer.from(secretClean, "base64");
    const toSign = `${msgId}.${timestamp}.${rawBody}`;
    const hmac = createHmac("sha256", secretBuf).update(toSign, "utf8").digest("base64");
    return hmac;
  }

  /**
   * Compares the incoming svix-signature header value against the expected base64 signature.
   * The header value may be "v1,<base64>", or multiple space-separated values.
   * Returns true if any version-1 signature in the header matches the expected value,
   * using a timing-safe comparison.
   */
  static compareSvixSignatures(svixSignatureHeader: string, expectedBase64: string): boolean {
    if (!svixSignatureHeader) return false;

    const parts = svixSignatureHeader.split(" ");
    const expectedBuf = Buffer.from(expectedBase64, "base64");

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith("v1,")) continue;
      const candidateBase64 = trimmed.slice(3);
      try {
        const candidateBuf = Buffer.from(candidateBase64, "base64");
        if (candidateBuf.length === expectedBuf.length) {
          if (timingSafeEqual(candidateBuf, expectedBuf)) {
            return true;
          }
        }
      } catch {
        // malformed base64 — skip this part
      }
    }
    return false;
  }
}
