// apps/api/src/modules/campaigns/campaign-webhook.controller.ts
//
// POST /api/v1/campaigns/webhooks/:channel — UNAUTHENTICATED (HMAC signature IS the auth).
//
// Deliberately kept in its OWN file, separate from campaigns.controller.ts: that file
// imports the full campaigns DTO/Zod-schema surface (@repo/types runtime values), which
// is an ESM-only package the unit-test Jest config cannot `require()`. This controller
// needs only the CampaignWebhookEventDto TYPE (erased at compile time) plus the
// MailProvider/WhatsAppProvider interfaces, so isolating it here keeps it directly
// unit-testable without pulling in that ESM boundary — mirrors the identical split
// already applied to commerce/webhook.controller.ts (see that file's header) and the
// pre-existing lms/video-webhook.controller.ts precedent.
//
// - Public — no JwtAuthGuard; HMAC verification via the provider's
//   verifyWebhookSignature() (FAIL CLOSED — 401 on missing/invalid signature or absent
//   secret) is the auth for this route.
// - CSRF exclusion: app.module.ts excludes /api/v1/campaigns/webhooks from CsrfMiddleware.
// - rawBody: true (main.ts) — HMAC is verified over the raw request bytes.
// - Idempotent by provider_message_id in CampaignsService — a forged/duplicate receipt
//   cannot corrupt status (AC-38).
//
// IP RATE LIMIT (Phase-7 Wave 2 security hardening, AC-58): WebhookIpRateLimitGuard is a
// PRE-CHECK — runs before signature verification, throttles by source IP alone,
// independent of whether the signature is ultimately valid. FAILS OPEN on a Redis error
// (HMAC verification below remains the primary control — see guard file header).
//
// SIGNATURE FRESHNESS WINDOW (AC-59 / P6 M-3): for the "email" channel, Resend signs
// webhooks using the Svix/Standard-Webhooks scheme, which includes a `svix-timestamp`
// header that IS part of the signed content (`id.timestamp.body`) — so a validly-signed
// but STALE payload (older than WEBHOOK_SIGNATURE_MAX_AGE_SECONDS) is rejected even
// though the signature verifies (anti-replay). The "whatsapp" channel (Meta's
// X-Hub-Signature-256 scheme) carries NO signed timestamp at all — freshness cannot be
// enforced for that channel; this is a documented vendor limitation, not an oversight.

import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { CampaignWebhookEventDto } from "@repo/types";
import { WebhookIpRateLimitGuard } from "../../common/rate-limit/webhook-ip-rate-limit.guard";
import { isWithinSignatureFreshnessWindow } from "../../common/webhook/signature-freshness";
import { validateEnv } from "../../config/env";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from "../notifications/providers/whatsapp/whatsapp-provider.interface";
import { CampaignsService } from "./campaigns.service";
import { normalizeCampaignWebhook } from "./campaign-webhook.normalizer";

@Controller("campaigns/webhooks")
@UseGuards(WebhookIpRateLimitGuard)
export class CampaignWebhookController {
  constructor(
    private readonly service: CampaignsService,
    @Inject(MAIL_PROVIDER) private readonly mailProvider: MailProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: WhatsAppProvider,
  ) {}

  /**
   * POST /api/v1/campaigns/webhooks/:channel  (channel = email | whatsapp)
   *
   * 1. Reads the raw body (rawBody: true in main.ts) — HMAC is over the raw bytes.
   * 2. Verifies the provider signature — FAIL CLOSED (401 on missing/invalid/no-secret).
   * 3. For "email": rejects a stale (but validly-signed) payload outside the freshness
   *    window (svix-timestamp). "whatsapp" has no signed timestamp to check.
   * 4. Normalizes the vendor payload → CampaignWebhookEventDto.
   * 5. service.handleWebhookEvent updates recipient status idempotently by providerMessageId.
   *
   * Returns 200 { received: true } even for unknown providerMessageId (AC-40 race: silent
   * discard) so providers do not retry-storm. Only signature/freshness failures return non-200.
   */
  @Post(":channel")
  @HttpCode(200)
  async handleWebhook(
    @Param("channel") channel: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException({
        code: "campaigns.webhook_raw_body_missing",
        title: "Raw body unavailable",
        detail: "rawBody: true must be set in NestFactory.create() options in main.ts.",
      });
    }
    const rawString = rawBody.toString("utf8");
    const env = validateEnv();

    let verified = false;
    if (channel === "email") {
      // Resend / Svix Standard Webhooks headers.
      verified = this.mailProvider.verifyWebhookSignature({
        rawBody: rawString,
        svixId: headers["svix-id"] ?? "",
        svixTimestamp: headers["svix-timestamp"] ?? "",
        svixSignature: headers["svix-signature"] ?? "",
        secret: env.MAIL_WEBHOOK_SECRET ?? "",
      });
    } else if (channel === "whatsapp") {
      // Meta X-Hub-Signature-256.
      verified = this.whatsappProvider.verifyWebhookSignature({
        rawBody,
        signature: headers["x-hub-signature-256"] ?? "",
        secret: env.WHATSAPP_APP_SECRET ?? "",
      });
    } else {
      // SMS (MSG91) delivery webhooks are out of P6 scope; unknown channel → reject.
      throw new UnauthorizedException({
        code: "campaigns.webhook_unknown_channel",
        title: "Unknown webhook channel",
        detail: `No verified webhook handler for channel="${channel}".`,
      });
    }

    if (!verified) {
      // FAIL CLOSED — forged or unverifiable receipt.
      throw new UnauthorizedException({
        code: "campaigns.webhook_invalid_signature",
        title: "Webhook signature invalid",
        detail: "HMAC verification failed. Possible forgery or missing webhook secret.",
      });
    }

    // FRESHNESS WINDOW (AC-59) — only enforceable for "email" (svix-timestamp is part
    // of the signed content). "whatsapp" (Meta) has no signed timestamp — see file header.
    if (channel === "email") {
      const svixTimestamp = Number(headers["svix-timestamp"]);
      if (!isWithinSignatureFreshnessWindow(svixTimestamp, env.WEBHOOK_SIGNATURE_MAX_AGE_SECONDS)) {
        throw new UnauthorizedException({
          code: "campaigns.webhook_stale_signature",
          title: "Webhook signature stale",
          detail: "The svix-timestamp is outside the allowed freshness window.",
        });
      }
    }

    // Normalize the (verified, fresh) vendor payload into the internal event shape.
    const events: CampaignWebhookEventDto[] = normalizeCampaignWebhook(
      channel as "email" | "whatsapp",
      rawString,
    );
    for (const event of events) {
      await this.service.handleWebhookEvent(event);
    }

    return { received: true };
  }
}
