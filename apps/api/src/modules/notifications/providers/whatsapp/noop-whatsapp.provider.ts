// apps/api/src/modules/notifications/providers/whatsapp/noop-whatsapp.provider.ts
//
// Test / sandbox double for WhatsAppProvider (Phase 6, docs/plans/phase-6.md §2,
// docs/specs/phase-6-engagement.md AC-12, LOCK-D2).
//
// Selected when WHATSAPP_PROVIDER=noop (or unset) in non-production environments.
// In production, the WhatsAppProviderModule factory refuses to bind this adapter —
// it throws a boot-time error (fail-closed) instead.
//
// ─── BEHAVIOUR ────────────────────────────────────────────────────────────────
//
//   sendTemplate(input):
//     Logs recipient + templateName + dltTemplateId (no access token in log).
//     Returns a synthetic providerMessageId "noop-wa-<timestamp>-<random>".
//     Makes ZERO network calls.
//
//   sendSession(input):
//     Logs recipient (no body content logged — may contain personal data).
//     Returns a synthetic providerMessageId "noop-wa-session-<timestamp>-<random>".
//     Makes ZERO network calls.
//
//   verifyWebhookSignature(input):
//     Performs a real HMAC-SHA256 verification using the `secret` field from input.
//     The "sha256=" prefix is stripped from the signature before comparison.
//     When secret is empty, returns false (fail-closed).
//     Use the static makeHubSignature() helper to derive valid signatures in tests.
//
// ─── SECURITY NOTE ────────────────────────────────────────────────────────────
//
//   This provider MUST NEVER be used in production. The WhatsAppProviderModule
//   factory enforces this: in production with WHATSAPP_PROVIDER=noop it throws
//   at boot rather than silently discarding all WhatsApp sends.
//
// ─── USAGE IN UNIT TESTS ──────────────────────────────────────────────────────
//
//   const noop = new NoopWhatsAppProvider();
//   const module = await Test.createTestingModule({
//     providers: [
//       NotificationsService,
//       { provide: WHATSAPP_PROVIDER, useValue: noop },
//     ],
//   }).compile();
//
//   // Derive a valid webhook signature for tests:
//   const rawBody = '{"object":"whatsapp_business_account","entry":[...]}';
//   const secret  = 'test-app-secret-never-expose';
//   const sig     = NoopWhatsAppProvider.makeHubSignature(rawBody, secret);
//   // → pass { rawBody, signature: sig, secret } to verifyWebhookSignature

import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  WhatsAppProvider,
  SendWhatsAppTemplateInput,
  SendWhatsAppTemplateResult,
  SendWhatsAppSessionInput,
  SendWhatsAppSessionResult,
  VerifyWhatsAppWebhookInput,
} from "./whatsapp-provider.interface";

export const NOOP_WHATSAPP_ID_PREFIX = "noop-wa-";

@Injectable()
export class NoopWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger(NoopWhatsAppProvider.name);

  constructor() {
    this.logger.warn(
      "[NoopWhatsAppProvider] Running with the no-op/test WhatsApp provider. " +
        "No messages will be sent. Do NOT use this in production. " +
        "Set WHATSAPP_PROVIDER=whatsapp_cloud with required keys for staging/prod.",
    );
  }

  async sendTemplate(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult> {
    this.logger.log(
      `[NoopWhatsAppProvider] sendTemplate: to=${input.to} ` +
        `template="${input.templateName}" dltTemplateId="${input.dltTemplateId}" ` +
        `lang="${input.languageCode ?? "en"}" vars=${JSON.stringify(input.variables ?? [])} (no network call)`,
    );
    const providerMessageId = `${NOOP_WHATSAPP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return { providerMessageId };
  }

  async sendSession(input: SendWhatsAppSessionInput): Promise<SendWhatsAppSessionResult> {
    // Log recipient only — NOT the body (may contain personal data).
    this.logger.log(
      `[NoopWhatsAppProvider] sendSession: to=${input.to} (body omitted from log) (no network call)`,
    );
    const providerMessageId = `${NOOP_WHATSAPP_ID_PREFIX}session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return { providerMessageId };
  }

  verifyWebhookSignature(input: VerifyWhatsAppWebhookInput): boolean {
    if (!input.secret) {
      this.logger.warn(
        "[NoopWhatsAppProvider] verifyWebhookSignature: secret is absent — returning false (fail-closed).",
      );
      return false;
    }

    try {
      const expected = NoopWhatsAppProvider.makeHubSignature(input.rawBody, input.secret);
      return NoopWhatsAppProvider.compareHubSignatures(input.signature, expected);
    } catch {
      this.logger.warn("[NoopWhatsAppProvider] verifyWebhookSignature: error during verification — returning false.");
      return false;
    }
  }

  // ─── Static test helpers ─────────────────────────────────────────────────────

  /**
   * Computes the Meta X-Hub-Signature-256 header value for a given body and app secret.
   * Returns the full header value: "sha256=<hex>".
   *
   * Usage in tests:
   *   const sig = NoopWhatsAppProvider.makeHubSignature(rawBody, 'my-app-secret');
   *   // pass { rawBody, signature: sig, secret: 'my-app-secret' } to verifyWebhookSignature
   *   // → returns true
   */
  static makeHubSignature(rawBody: string | Buffer, secret: string): string {
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const hex = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    return `sha256=${hex}`;
  }

  /**
   * Timing-safe comparison between the incoming header and the expected signature.
   * The incoming signature should be "sha256=<hex>"; we strip the prefix before compare.
   */
  static compareHubSignatures(incoming: string, expected: string): boolean {
    if (!incoming || !expected) return false;

    // Strip "sha256=" prefix from both (in case expected already has it).
    const incomingHex = incoming.startsWith("sha256=") ? incoming.slice(7) : incoming;
    const expectedHex = expected.startsWith("sha256=") ? expected.slice(7) : expected;

    if (incomingHex.length !== expectedHex.length || incomingHex.length === 0) return false;

    try {
      return timingSafeEqual(Buffer.from(incomingHex, "hex"), Buffer.from(expectedHex, "hex"));
    } catch {
      return false;
    }
  }
}
