// apps/api/src/modules/notifications/providers/mail/resend-mail.provider.ts
//
// Real MailProvider adapter backed by the Resend SDK (Phase 6, LOCK-D2).
// Selected when MAIL_PROVIDER=resend. Requires RESEND_API_KEY + MAIL_FROM.
//
// ─── SECURITY RULES ───────────────────────────────────────────────────────────
//   - RESEND_API_KEY is read from env at construction. It is never logged,
//     never returned in any method result, and never exposed to the caller.
//   - verifyWebhookSignature does NOT throw — returns false on any failure.
//   - Errors from Resend are caught, logged without credential leakage, and rethrown
//     as generic Error so the caller never sees the raw Resend response body.
//   - MAIL_FROM is the verified sender address; never set by the caller.
//
// ─── CONSTRUCTOR BEHAVIOUR ────────────────────────────────────────────────────
//   Does NOT throw when keys are absent (lazy validation, ADR-0023 pattern).
//   Throws at call time in send() and logs a clear error in verifyWebhookSignature().
//   The MailProviderModule factory enforces key-presence at boot (fail-closed in prod).
//
// ─── WEBHOOK VERIFICATION ────────────────────────────────────────────────────
//   Resend uses the Standard Webhooks / Svix scheme:
//     Headers: svix-id, svix-timestamp, svix-signature
//   resend.webhooks.verify() throws if invalid; we catch and return false.
//   Secret: MAIL_WEBHOOK_SECRET (the signing secret from the Resend webhook dashboard).
//   Fail-closed when MAIL_WEBHOOK_SECRET is absent.
//
// ─── IDEMPOTENCY ──────────────────────────────────────────────────────────────
//   The caller (NotificationsService / CampaignService) is responsible for
//   setting the Idempotency-Key header when warranted. The interface does not
//   yet expose it — that is a campaign-layer concern (task #7).
//
// References:
//   docs/plans/phase-6.md §2, docs/specs/phase-6-engagement.md AC-12/13/37/39/76
//   Resend SDK: https://resend.com/docs/api-reference/emails/send-email
//   Svix webhooks: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests

import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { validateEnv } from "../../../../config/env";
import type {
  MailProvider,
  SendMailInput,
  SendMailResult,
  VerifyMailWebhookInput,
} from "./mail-provider.interface";

@Injectable()
export class ResendMailProvider implements MailProvider {
  private readonly logger = new Logger(ResendMailProvider.name);
  /**
   * Resend client. Lazily initialised on first call so the constructor does
   * not throw when RESEND_API_KEY is absent in non-production environments.
   * The MailProviderModule factory validates keys at boot in production.
   */
  private client: Resend | undefined;
  private from: string | undefined;

  constructor() {
    // Constructor does NOT throw — lazy validation per ADR-0023.
    // Keys are validated at call time (and enforced by the module factory at boot in prod).
    this.logger.log(
      "[ResendMailProvider] Constructed. RESEND_API_KEY and MAIL_FROM will be " +
        "validated on first send() call (and at boot in production).",
    );
  }

  /**
   * Lazy getter for the Resend client.
   * Throws a descriptive error if RESEND_API_KEY is absent (so the error surfaces
   * at call-time in non-prod, at boot in prod via the module factory check).
   */
  private getClient(): { client: Resend; from: string } {
    if (this.client && this.from) {
      return { client: this.client, from: this.from };
    }
    const env = validateEnv();
    if (!env.RESEND_API_KEY) {
      throw new Error(
        "[ResendMailProvider] RESEND_API_KEY is not set. " +
          "Set RESEND_API_KEY and MAIL_PROVIDER=resend in your environment. " +
          "Use MAIL_PROVIDER=noop for local dev without credentials.",
      );
    }
    if (!env.MAIL_FROM) {
      throw new Error(
        "[ResendMailProvider] MAIL_FROM is not set. " +
          "Set MAIL_FROM to your verified sender address (e.g. noreply@yourdomain.com). " +
          "The sender domain must be verified in the Resend dashboard.",
      );
    }
    this.client = new Resend(env.RESEND_API_KEY);
    this.from = env.MAIL_FROM;
    return { client: this.client, from: this.from };
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    const { client, from } = this.getClient();

    this.logger.log(
      `[ResendMailProvider] send: to=${input.to} subject="${input.subject}"`,
    );

    // Build the content portion explicitly so TypeScript can confirm at least one
    // of html/text is present (RequireAtLeastOne<EmailRenderOptions> constraint).
    // We always pass html if available, text as fallback, ensuring the union arm
    // that requires html|text|react is satisfied at the type level.
    const content: { html?: string; text?: string } = {};
    if (input.html) content.html = input.html;
    if (input.text) content.text = input.text;
    // Guarantee at least one content field is present (interface requires html|text).
    // If neither is supplied, use text: "" as a safe fallback (Resend will reject
    // empty emails at the API level, but this avoids a type cast at compile time).
    if (!content.html && !content.text) content.text = "";

    // Resend SDK's
    // CreateEmailOptions is a complex discriminated union; casting via any here is
    // the only ergonomic way to satisfy the RequireAtLeastOne<EmailRenderOptions>
    // constraint when we cannot statically prove which fields are present. The
    // content object above guarantees at least one of html/text is set.
    const payload = {
      from,
      to: input.to,
      subject: input.subject,
      ...content,
      ...(input.tags && input.tags.length > 0
        ? { tags: input.tags.map((t) => ({ name: t.name, value: t.value })) }
        : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const { data, error } = await client.emails.send(payload);

    if (error || !data?.id) {
      // Log error name only — never the full Resend error (may contain key info).
      const errorMsg = error ? `${error.name}: ${error.message}` : "no data.id returned";
      this.logger.error(`[ResendMailProvider] send failed: ${errorMsg}`);
      throw new Error(`ResendMailProvider send failed: ${errorMsg}`);
    }

    return { providerMessageId: data.id };
  }

  verifyWebhookSignature(input: VerifyMailWebhookInput): boolean {
    if (!input.secret) {
      this.logger.warn(
        "[ResendMailProvider] verifyWebhookSignature: MAIL_WEBHOOK_SECRET is absent — " +
          "returning false (fail-closed). Set MAIL_WEBHOOK_SECRET in your environment.",
      );
      return false;
    }

    try {
      const { client } = this.getClient();
      // resend.webhooks.verify() throws a Svix error if verification fails.
      // We catch it and return false — the caller must return 401.
      client.webhooks.verify({
        payload: input.rawBody,
        headers: {
          id: input.svixId,
          timestamp: input.svixTimestamp,
          signature: input.svixSignature,
        },
        webhookSecret: input.secret,
      });
      return true;
    } catch (err: unknown) {
      // Log the error type only — never log the secret or the raw signature.
      const name = err instanceof Error ? err.constructor.name : "UnknownError";
      this.logger.warn(
        `[ResendMailProvider] verifyWebhookSignature: verification failed (${name}) — returning false.`,
      );
      return false;
    }
  }
}
