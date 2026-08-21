// apps/api/src/modules/lms/video-webhook.controller.ts
//
// Transcode-status webhook from the video provider (Cloudflare Stream / Mux / Noop).
// Mounted at POST /api/v1/lms/videos/webhook.
//
// ─── SECURITY CONTRACT ────────────────────────────────────────────────────────
//
//   No @UseGuards()  — following the exact precedent in commerce.controller.ts's
//                      WebhookController and leads/bookings.controller.ts's
//                      PublicBookingsController (confirmed codebase pattern: no
//                      @Public() decorator exists; public endpoints use a SEPARATE
//                      controller class with no guards, not a decorator).
//   HMAC auth        — verifyWebhookSignature() IS the authentication.
//   rawBody: true    — required in main.ts (already set for P2 Razorpay webhook).
//   CSRF-excluded    — webhook is called by the provider server (not a browser);
//                      added to the CSRF exclude list in app.module.ts.
//   FAIL CLOSED      — verifyWebhookSignature() returns false → immediate 401;
//                      payload is NEVER processed without a valid signature.
//   Idempotent       — VideoWebhookProcessorPort.process() is idempotent by design.
//
// ─── HEADER CONVENTIONS ───────────────────────────────────────────────────────
//
//   Cloudflare Stream: `Webhook-Signature` header → "time=<ts>,sig1=<hex>"
//   Mux:               `Mux-Signature` header → "t=<ts>,v1=<hex>"
//   Noop (tests):      `Webhook-Signature` header → HMAC-SHA256(rawBody, secret)
//
//   The controller reads BOTH header names and passes whichever is non-empty.
//
// ─── RAW BODY ─────────────────────────────────────────────────────────────────
//
//   main.ts must have: NestFactory.create(AppModule, { rawBody: true })
//   This is already set from the P2 Razorpay webhook. If not present, add it.

import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { VIDEO_PROVIDER } from "./providers/video/video-provider.interface";
import type { VideoProvider } from "./providers/video/video-provider.interface";
import { VIDEO_WEBHOOK_PROCESSOR_PORT } from "./lms-video-webhook.seam";
import type { VideoWebhookProcessorPort } from "./lms-video-webhook.seam";

/**
 * Standalone webhook controller — NO JwtAuthGuard, NO PermissionsGuard.
 * Following the codebase pattern (commerce.controller.ts WebhookController +
 * bookings.controller.ts PublicBookingsController): public/webhook endpoints use
 * a separate class with no guards rather than a @Public() decorator.
 *
 * The HMAC signature IS the authentication for this endpoint.
 */
@Controller("lms/videos")
export class VideoWebhookController {
  private readonly logger = new Logger(VideoWebhookController.name);

  constructor(
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
    @Inject(VIDEO_WEBHOOK_PROCESSOR_PORT) private readonly webhookProcessor: VideoWebhookProcessorPort,
  ) {}

  /**
   * POST /api/v1/lms/videos/webhook
   *
   * Receives transcode-status events from the video provider (Cloudflare Stream / Mux).
   * Auth: HMAC signature verification (videoProvider.verifyWebhookSignature).
   * Processing: idempotent status update via VideoWebhookProcessorPort.
   *
   * Security notes:
   *   - No JwtAuthGuard (separate class, no guards — codebase convention).
   *   - CSRF-excluded in app.module.ts.
   *   - rawBody required (set in main.ts with { rawBody: true }).
   *   - Fail-closed: verifyWebhookSignature returns false → 401; payload never touched.
   */
  @Post("webhook")
  @HttpCode(200)
  async handleTranscodeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("webhook-signature") cfSig: string | undefined,
    @Headers("mux-signature") muxSig: string | undefined,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException({
        code: "lms.webhook_raw_body_missing",
        title: "Raw body unavailable",
        detail:
          "The webhook handler requires rawBody:true in NestFactory.create(). " +
          "Ensure main.ts has: NestFactory.create(AppModule, { rawBody: true }).",
      });
    }

    // Resolve which signature header to use.
    // Cloudflare/Noop tests use 'webhook-signature'; Mux uses 'mux-signature'.
    const signatureHeader = cfSig ?? muxSig ?? "";

    // FAIL CLOSED: reject immediately if signature is absent or invalid.
    // verifyWebhookSignature() returns false (never throws) when:
    //   - The webhook secret is not configured.
    //   - The signature does not match.
    const isValid = this.videoProvider.verifyWebhookSignature({
      rawBody,
      signatureHeader,
    });

    if (!isValid) {
      this.logger.warn(
        "[VideoWebhook] Signature verification failed, rejecting webhook (fail closed). " +
          `Has-CF-header=${Boolean(cfSig)} Has-Mux-header=${Boolean(muxSig)}`,
      );
      throw new UnauthorizedException({
        code: "lms.webhook_signature_invalid",
        title: "Webhook signature invalid",
        detail: "HMAC signature verification failed. The request may be forged or the webhook secret is misconfigured.",
      });
    }

    // Parse the event. Returns null for unrecognized event types — safe to ignore.
    const body = req.body as Record<string, unknown>;
    const event = this.videoProvider.parseTranscodeEvent(body);

    if (!event) {
      this.logger.debug("[VideoWebhook] Non-transcode event received, ignoring (safe no-op)");
      return { received: true };
    }

    // Process the event idempotently via the port (ADR-0020 BullMQ seam).
    await this.webhookProcessor.process(event);

    return { received: true };
  }
}
