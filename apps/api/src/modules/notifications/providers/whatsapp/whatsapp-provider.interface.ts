// apps/api/src/modules/notifications/providers/whatsapp/whatsapp-provider.interface.ts
//
// Vendor-swappable WhatsAppProvider interface (CLAUDE.md §3.7 rule 7, Phase 6
// docs/plans/phase-6.md §2, docs/specs/phase-6-engagement.md LOCK-D2/LOCK-D4).
//
// DI token: WHATSAPP_PROVIDER (Symbol)
// Adapter selected by WHATSAPP_PROVIDER env var (default: "noop"):
//   noop            → NoopWhatsAppProvider   (dev/test — no network)
//   whatsapp_cloud  → WhatsAppCloudProvider  (Meta WhatsApp Cloud API — direct fetch)
//   (future)        → GupshupProvider        (Gupshup HTTP API — slot reserved)
//
// India DLT compliance (LOCK-D4, AC-31, AC-78):
//   Every sendTemplate() call MUST carry a non-empty dltTemplateId.
//   sendTemplate() MUST reject calls without dltTemplateId before any network
//   call (rule C-3 in phase-6-engagement.md §Part 7). This is enforced at the
//   service layer (NotificationService / CampaignService), not at the adapter.
//
// Webhook verification (AC-37–AC-39):
//   WhatsApp Cloud API sends delivery/read receipts via POST webhooks.
//   Meta signs the request body using HMAC-SHA256 with your App Secret.
//   Header: X-Hub-Signature-256: sha256=<hex>
//   verifyWebhookSignature() returns false (not throws) on any failure.
//   Fail-closed when WHATSAPP_APP_SECRET is absent.
//
// Hub verification challenge (Meta webhook subscription):
//   WhatsApp Cloud API sends a GET request with hub.mode=subscribe,
//   hub.verify_token, and hub.challenge during webhook setup.
//   The controller handles this by checking hub.verify_token against
//   WHATSAPP_VERIFY_TOKEN env var and echoing hub.challenge back.
//   This interface does NOT model the GET challenge (it is controller logic,
//   not provider logic).
//
// ─── FEATURE MODULE WIRING ───────────────────────────────────────────────────
//
//   // notifications.module.ts (or campaigns.module.ts)
//   import { WhatsAppProviderModule }
//     from './providers/whatsapp/whatsapp-provider.module';
//
//   @Module({
//     imports: [WhatsAppProviderModule, ...],
//     providers: [NotificationsService, ...],
//   })
//   export class NotificationsModule {}
//
//   // notifications.service.ts
//   import { Inject } from '@nestjs/common';
//   import { WHATSAPP_PROVIDER, WhatsAppProvider }
//     from './providers/whatsapp/whatsapp-provider.interface';
//
//   @Injectable()
//   export class NotificationsService {
//     constructor(
//       @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
//     ) {}
//   }
//
// ─── WEBHOOK CONTROLLER REQUIREMENTS ────────────────────────────────────────
//
//   POST /api/v1/campaigns/webhooks/whatsapp MUST:
//     1. Use @Public() — HMAC is the auth.
//     2. Receive raw request body (rawBody: true in NestFactory.create).
//     3. Extract "x-hub-signature-256" header verbatim.
//     4. Call verifyWebhookSignature({ rawBody, signature, secret }).
//     5. Return 401 immediately on false.
//     6. Be excluded from CSRF middleware.
//   WHATSAPP_APP_SECRET (env) is the Meta app secret used for webhook signing.
//
// ─── TEST WIRING ─────────────────────────────────────────────────────────────
//
//   import { NoopWhatsAppProvider }
//     from './providers/whatsapp/noop-whatsapp.provider';
//
//   const noop = new NoopWhatsAppProvider();
//   await Test.createTestingModule({
//     providers: [
//       NotificationsService,
//       { provide: WHATSAPP_PROVIDER, useValue: noop },
//     ],
//   }).compile();

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Input to WhatsAppProvider.sendTemplate().
 *
 * India DLT compliance (LOCK-D4, AC-78):
 *   dltTemplateId is a REQUIRED field for Indian telecom compliance.
 *   It is the DLT-registered approved template identifier assigned by the DLT
 *   portal (e.g. Jio DLT, BSNL DLT, TRAI). The Meta WhatsApp Cloud API maps
 *   this to the template name (templateName) — callers must coordinate the
 *   mapping. Sends without dltTemplateId are rejected before any provider call.
 */
export interface SendWhatsAppTemplateInput {
  /**
   * Recipient WhatsApp phone number in E.164 format (e.g. "+919876543210").
   * The leading "+" is required; do NOT include spaces or dashes.
   */
  to: string;
  /**
   * The WhatsApp template name as approved in Meta's Business Manager.
   * This is the internal template identifier used in the Cloud API call.
   */
  templateName: string;
  /**
   * India DLT-registered template identifier (REQUIRED — AC-78, Rule C-3).
   * This is the ID assigned by the DLT portal (Jio/BSNL/Airtel/etc.) for the
   * registered template body. The service layer rejects sends without this field.
   * The adapter passes it as a custom parameter / tag for regulatory audit trail.
   */
  dltTemplateId: string;
  /**
   * ISO 639-1 language code for the template (e.g. "en", "hi", "te").
   * Defaults to "en" if omitted.
   */
  languageCode?: string;
  /**
   * Template variable substitutions. Each entry corresponds to a numbered
   * placeholder in the template body (e.g. {{1}}, {{2}} …) in order.
   * The adapter builds the `components.parameters` array from this list.
   */
  variables?: string[];
}

/** Result returned by WhatsAppProvider.sendTemplate(). */
export interface SendWhatsAppTemplateResult {
  /**
   * The provider-assigned message ID for this WhatsApp message.
   * Returned by the WhatsApp Cloud API as messages[0].id.
   * Stored in campaign_recipients.provider_message_id for delivery tracking.
   * NEVER contains credentials, tokens, or App Secrets.
   */
  providerMessageId: string;
}

/**
 * Input to WhatsAppProvider.sendSession().
 * Used for free-form replies within an active 24-hour customer-service window.
 * NOT subject to DLT template requirements (the user opened the conversation).
 */
export interface SendWhatsAppSessionInput {
  /**
   * Recipient WhatsApp phone number in E.164 format.
   */
  to: string;
  /**
   * Free-form message body (up to 4096 chars per WhatsApp limits).
   */
  body: string;
}

/** Result returned by WhatsAppProvider.sendSession(). */
export interface SendWhatsAppSessionResult {
  /** Provider-assigned message ID. Never contains secrets. */
  providerMessageId: string;
}

/**
 * Input for WhatsAppProvider.verifyWebhookSignature().
 * Meta signs the POST body using HMAC-SHA256 with your App Secret.
 */
export interface VerifyWhatsAppWebhookInput {
  /** Raw request body string (read before any JSON.parse). */
  rawBody: string | Buffer;
  /**
   * Full value of the "x-hub-signature-256" header, e.g. "sha256=<hex>".
   * The adapter strips the "sha256=" prefix before comparison.
   */
  signature: string;
  /**
   * Your Meta App Secret (WHATSAPP_APP_SECRET from env).
   * NEVER log or return this. Used to compute the expected HMAC.
   */
  secret: string;
}

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * WhatsAppProvider — the vendor-agnostic WhatsApp interface.
 * Feature modules depend ONLY on this interface, never on a concrete adapter.
 */
export interface WhatsAppProvider {
  /**
   * Send a pre-approved WhatsApp template message (required for proactive outreach
   * in India — DLT compliance, LOCK-D4).
   *
   * The caller (NotificationService / CampaignService) is responsible for:
   *   - Ensuring dltTemplateId is non-empty (Rule C-3).
   *   - Checking notification_suppressions before calling this method.
   *   - Handling thrown errors and updating campaign_recipients accordingly.
   *
   * NEVER includes secrets, access tokens, or App Secrets in the result.
   */
  sendTemplate(input: SendWhatsAppTemplateInput): Promise<SendWhatsAppTemplateResult>;

  /**
   * Send a free-form message within a 24-hour customer-service reply window.
   * This bypasses the DLT template requirement because the user initiated contact.
   *
   * Usage: forward-only replies within an active session, not proactive outreach.
   */
  sendSession(input: SendWhatsAppSessionInput): Promise<SendWhatsAppSessionResult>;

  /**
   * Verify the HMAC-SHA256 signature of an inbound Meta WhatsApp Cloud API webhook.
   *
   * Returns true  → signature valid; safe to process the event.
   * Returns false → invalid signature, absent App Secret, or malformed header.
   *                 Caller MUST return 401 without processing the payload.
   *
   * NEVER throws. NEVER logs the App Secret or raw signature.
   *
   * (AC-39 equivalence: "Forged webhook is rejected — fail-closed when secret is absent")
   */
  verifyWebhookSignature(input: VerifyWhatsAppWebhookInput): boolean;
}

// ─── DI Token ────────────────────────────────────────────────────────────────

/** Symbol token for injecting the WhatsAppProvider via NestJS DI. */
export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");
