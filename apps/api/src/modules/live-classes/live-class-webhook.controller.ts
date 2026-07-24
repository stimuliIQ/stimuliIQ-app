// apps/api/src/modules/live-classes/live-class-webhook.controller.ts
//
// Recording/attendance webhook from the live-class provider (Zoom / Google Meet / Noop).
// Mounted at POST /api/v1/live-classes/webhook. Mirrors video-webhook.controller.ts's
// SECURITY CONTRACT exactly:
//
//   No @UseGuards()  — separate controller class with no guards (codebase convention:
//                      commerce.controller.ts's WebhookController, lms's
//                      VideoWebhookController). The HMAC signature IS the authentication.
//   rawBody: true    — already set globally in main.ts.
//   CSRF-excluded    — added to the CSRF exclude list in app.module.ts.
//   FAIL CLOSED      — verifyWebhookSignature() returns false → immediate 401; payload is
//                      NEVER processed without a valid signature (live-class-provider.
//                      interface.ts SECURITY CONTRACT point 3 — Google Meet's adapter
//                      always returns false here, since Meet has no verifiable webhook
//                      HMAC; Meet attendance/recording sync is a documented follow-up via
//                      polling, not webhook, per that adapter's own doc comment).
//   Idempotent       — LiveClassWebhookProcessorPort.process() is idempotent by design.
//
// HEADER CONVENTION: Zoom sends `x-zm-signature` + `x-zm-request-timestamp`. Zoom's
// `endpoint.url_validation` challenge (sent once, at webhook subscription time) has no
// signature to verify — handled explicitly BEFORE verifyWebhookSignature(), exactly as
// live-class-provider.interface.ts documents.

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
import { LIVE_CLASS_PROVIDER, type LiveClassProvider } from "../lms/providers/live-class/live-class-provider.interface";
import { buildZoomUrlValidationResponse } from "../lms/providers/live-class/zoom-live-class.provider";
import { LIVE_CLASS_WEBHOOK_PORT, type LiveClassWebhookProcessorPort } from "./live-class-webhook.seam";
import { validateEnv } from "../../config/env";

/**
 * Standalone webhook controller — NO JwtAuthGuard, NO PermissionsGuard. The HMAC
 * signature IS the authentication for this endpoint.
 */
@Controller("live-classes")
export class LiveClassWebhookController {
  private readonly logger = new Logger(LiveClassWebhookController.name);

  constructor(
    @Inject(LIVE_CLASS_PROVIDER) private readonly liveClassProvider: LiveClassProvider,
    @Inject(LIVE_CLASS_WEBHOOK_PORT) private readonly webhookProcessor: LiveClassWebhookProcessorPort,
  ) {}

  /**
   * POST /api/v1/live-classes/webhook
   *
   * Receives meeting-lifecycle + recording events from the live-class provider.
   * Auth: HMAC signature verification (liveClassProvider.verifyWebhookSignature).
   */
  @Post("webhook")
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-zm-signature") zmSig: string | undefined,
    @Headers("x-zm-request-timestamp") zmTimestamp: string | undefined,
    @Headers("webhook-signature") noopSig: string | undefined,
  ): Promise<{ received: boolean } | Record<string, unknown>> {
    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException({
        code: "liveclass.webhook_raw_body_missing",
        title: "Raw body unavailable",
        detail:
          "The webhook handler requires rawBody:true in NestFactory.create(). " +
          "Ensure main.ts has: NestFactory.create(AppModule, { rawBody: true }).",
      });
    }

    const body = req.body as Record<string, unknown>;

    // Zoom's one-time `endpoint.url_validation` challenge has NO signature to verify —
    // handled explicitly BEFORE verifyWebhookSignature (interface contract). This is the
    // ONE deliberate, documented exception to "never call a vendor SDK/adapter directly
    // from a feature module" (CLAUDE.md §3.7): `buildZoomUrlValidationResponse` is a pure,
    // side-effect-free HMAC helper (not a vendor SDK call), and the interface's own doc
    // comment on `VerifyWebhookSignatureInput` names this exact import path as the
    // required integration point for this one-time, out-of-band challenge.
    if (body["event"] === "endpoint.url_validation") {
      const payload = body["payload"] as Record<string, unknown> | undefined;
      const plainToken = typeof payload?.["plainToken"] === "string" ? (payload["plainToken"] as string) : undefined;
      const secret = validateEnv().ZOOM_WEBHOOK_SECRET_TOKEN;
      if (!plainToken || !secret) {
        throw new BadRequestException({
          code: "liveclass.webhook_url_validation_misconfigured",
          title: "Cannot complete Zoom URL validation challenge",
          detail: "Missing plainToken in payload or ZOOM_WEBHOOK_SECRET_TOKEN is not configured.",
        });
      }
      return buildZoomUrlValidationResponse(plainToken, secret);
    }

    const signatureHeader = zmSig ?? noopSig ?? "";

    // FAIL CLOSED: reject immediately if signature is absent or invalid. Google Meet's
    // adapter always returns false here (no verifiable HMAC scheme) — Meet attendance/
    // recording sync is documented as a polling follow-up, not this webhook path.
    const isValid = this.liveClassProvider.verifyWebhookSignature({
      rawBody,
      signatureHeader,
      timestampHeader: zmTimestamp,
    });

    if (!isValid) {
      this.logger.warn(
        "[LiveClassWebhook] Signature verification failed — rejecting webhook (fail closed). " +
          `Has-Zoom-header=${Boolean(zmSig)} Has-Noop-header=${Boolean(noopSig)}`,
      );
      throw new UnauthorizedException({
        code: "liveclass.webhook_signature_invalid",
        title: "Webhook signature invalid",
        detail: "HMAC signature verification failed. The request may be forged or the webhook secret is misconfigured.",
      });
    }

    const event = this.liveClassProvider.parseRecordingEvent(body);
    if (!event) {
      this.logger.debug("[LiveClassWebhook] Unrecognised event payload — ignoring (safe no-op)");
      return { received: true };
    }

    await this.webhookProcessor.process(event);
    return { received: true };
  }
}
