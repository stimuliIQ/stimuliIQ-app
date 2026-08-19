// apps/api/src/modules/notifications/providers/mail/mail-provider.interface.ts
//
// Vendor-swappable MailProvider interface (CLAUDE.md §3.7 rule 7:
// "all external calls go through a provider interface — never call a vendor SDK
// directly from a feature module"). Phase 6 engagement (docs/plans/phase-6.md §2
// "New provider + queue seams").
//
// DI token: MAIL_PROVIDER (Symbol)
// Adapter selected by MAIL_PROVIDER env var (default: "noop"):
//   noop         → NoopMailProvider   (dev/test — no network)
//   resend       → ResendMailProvider (Resend SDK — requires RESEND_API_KEY + MAIL_FROM)
//   (future)     → SesMailProvider   (AWS SES — slot: SES_REGION + SES_ACCESS_KEY_ID + SES_SECRET_ACCESS_KEY)
//
// Fail-closed rule (AC-13, LOCK-D2):
//   In production (NODE_ENV=production or APP_ENV=production), if MAIL_PROVIDER=resend but
//   RESEND_API_KEY or MAIL_FROM is absent, the factory throws at boot — no partial-boot.
//   In non-production, missing keys fall back to NoopMailProvider with a loud warning.
//
// Webhook verification (AC-37–AC-39, docs/specs/phase-6-engagement.md §WS-2B):
//   Resend signs webhooks using the Standard Webhooks / Svix scheme:
//     headers: { "svix-id": string, "svix-timestamp": string, "svix-signature": string }
//   verifyWebhookSignature() returns false (not throws) when the secret is absent or
//   the signature does not match — fail-closed at the call site.
//
// Feature modules MUST import ONLY this file (interface + token).
// They MUST NOT import any Resend/SES SDK type.
//
// ─── FEATURE MODULE WIRING ───────────────────────────────────────────────────
//
//   // notifications.module.ts
//   import { MailProviderModule }
//     from './providers/mail/mail-provider.module';
//
//   @Module({
//     imports: [MailProviderModule, ...],
//     providers: [NotificationsService, ...],
//   })
//   export class NotificationsModule {}
//
//   // notifications.service.ts
//   import { Inject } from '@nestjs/common';
//   import { MAIL_PROVIDER, MailProvider }
//     from './providers/mail/mail-provider.interface';
//
//   @Injectable()
//   export class NotificationsService {
//     constructor(
//       @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
//     ) {}
//   }
//
// ─── WEBHOOK CONTROLLER REQUIREMENTS ────────────────────────────────────────
//
//   POST /api/v1/campaigns/webhooks/email MUST:
//     1. Use @Public() — the HMAC signature is the auth mechanism.
//     2. Receive the raw request body (rawBody: true in NestFactory.create).
//     3. Extract svix-id, svix-timestamp, svix-signature headers verbatim.
//     4. Call verifyWebhookSignature({ rawBody, svixId, svixTimestamp, svixSignature, secret }).
//     5. Return 401 immediately on false — no further processing.
//     6. Be excluded from CSRF middleware.
//   The MAIL_WEBHOOK_SECRET env var is the secret registered in the Resend dashboard.
//
// ─── TEST WIRING ─────────────────────────────────────────────────────────────
//
//   import { NoopMailProvider }
//     from './providers/mail/noop-mail.provider';
//
//   const noop = new NoopMailProvider();
//   const module = await Test.createTestingModule({
//     providers: [
//       NotificationsService,
//       { provide: MAIL_PROVIDER, useValue: noop },
//     ],
//   }).compile();

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A key-value tag attached to a sent email. Used for tracking/categorisation
 * in the Resend dashboard. Tags are provider-agnostic metadata; the adapter
 * maps them to provider-specific tag format.
 */
export interface MailTag {
  /** Tag key, e.g. "category" or "type". */
  name: string;
  /** Tag value, e.g. "transactional" or "grade_ready". */
  value: string;
}

/**
 * A file attached to an outgoing email.
 *
 * Attachments are the EXCEPTION, not the norm. Everything this platform sends a person —
 * receipts, certificates, invoices — is a signed link, because a link keeps large bytes off
 * the API process and lets access be revoked. The one thing that earns an attachment is a
 * document the recipient is expected to KEEP and act on outside our system, where a link
 * that expires makes the message worthless: the offer letter a candidate signs
 * (docs/specs/careers-hiring.md, ADR-0066).
 *
 * Keep them small. Providers cap total message size (Resend: 40 MB), and the bytes sit in
 * the API's memory for the duration of the send.
 */
export interface MailAttachment {
  /** Filename the recipient sees, e.g. "Offer-Letter-Priya-Sharma.pdf". */
  filename: string;
  /** The file's bytes. */
  content: Buffer;
  /** MIME type, e.g. "application/pdf". */
  contentType: string;
}

/** Input to MailProvider.send(). */
export interface SendMailInput {
  /** Recipient email address. */
  to: string;
  /** Email subject line. */
  subject: string;
  /** HTML body. At least one of html or text MUST be provided. */
  html?: string;
  /** Plain-text body fallback. At least one of html or text MUST be provided. */
  text?: string;
  /**
   * Optional key-value tags for tracking in the provider dashboard.
   * These are NOT rendered in the email body; they are metadata only.
   * Never include PII (name, phone, address) in tag values.
   */
  tags?: MailTag[];

  /**
   * Files to attach. See MailAttachment for when this is appropriate — the answer is
   * "almost never; prefer a signed link".
   */
  attachments?: MailAttachment[];
}

/** Result returned by MailProvider.send(). */
export interface SendMailResult {
  /**
   * The provider-assigned message ID for this email.
   * Returned by Resend as the top-level `id` field.
   * Stored in campaign_recipients.provider_message_id for delivery tracking.
   * NEVER contains credentials, secrets, or API keys.
   */
  providerMessageId: string;
}

/**
 * Input for MailProvider.verifyWebhookSignature().
 * Resend uses the Standard Webhooks (Svix) signature scheme.
 * The three Svix headers MUST be passed verbatim from the HTTP request.
 */
export interface VerifyMailWebhookInput {
  /** Raw request body as a string (read before any JSON.parse). */
  rawBody: string;
  /** Value of the "svix-id" header. */
  svixId: string;
  /** Value of the "svix-timestamp" header. */
  svixTimestamp: string;
  /** Value of the "svix-signature" header (e.g. "v1,base64-encoded-sig"). */
  svixSignature: string;
  /**
   * Webhook endpoint signing secret registered in the Resend dashboard.
   * This is MAIL_WEBHOOK_SECRET from env — never log or return it.
   */
  secret: string;
}

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * MailProvider — the vendor-agnostic email interface.
 * Feature modules depend ONLY on this interface, never on a concrete adapter.
 */
export interface MailProvider {
  /**
   * Send a transactional or campaign email.
   *
   * Implementations MUST:
   *   - Send from MAIL_FROM (the verified sender address).
   *   - Return a providerMessageId — the message's ID in the provider system.
   *   - NEVER include secrets, API keys, or internal IDs in the result.
   *   - Throw on hard errors (network failure, authentication failure).
   *
   * Callers are responsible for catching errors, logging them (without secret
   * material), and updating campaign_recipients accordingly.
   */
  send(input: SendMailInput): Promise<SendMailResult>;

  /**
   * Verify the HMAC-SHA256 signature of an inbound Resend delivery webhook.
   *
   * Returns true  → signature is valid; safe to process the event.
   * Returns false → signature invalid, absent secret, or malformed header.
   *                 The caller MUST return 401 without processing the payload.
   *
   * NEVER throws — failure is a boolean false (fail-closed at call site).
   * NEVER logs the secret or the raw signature value.
   *
   * (AC-39: "Forged webhook is rejected — fail-closed when the secret is absent")
   */
  verifyWebhookSignature(input: VerifyMailWebhookInput): boolean;
}

// ─── DI Token ────────────────────────────────────────────────────────────────

/** Symbol token for injecting the MailProvider via NestJS DI. */
export const MAIL_PROVIDER = Symbol("MAIL_PROVIDER");
