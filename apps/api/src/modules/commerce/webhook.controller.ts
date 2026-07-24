// apps/api/src/modules/commerce/webhook.controller.ts
//
// POST /api/v1/commerce/payments/webhook — UNAUTHENTICATED (Razorpay HMAC IS the auth).
//
// Deliberately kept in its OWN file, separate from commerce.controller.ts: that file
// imports the full commerce DTO/Zod-schema surface (./dto -> @repo/types runtime
// values), which is an ESM-only package the unit-test Jest config cannot `require()`.
// WebhookController needs none of those DTOs — only the PaymentProvider interface,
// CommerceService, and plain env/util helpers — so isolating it here keeps it directly
// unit-testable (see webhook.controller.spec.ts) without pulling in that ESM boundary.
// (This split also matches CLAUDE.md's "keep modules cleanly bounded so hot ones ... can
// be extracted later" — the public unauthenticated webhook surface is exactly such a seam.)
//
// - @Public() — no JwtAuthGuard (Razorpay calls this from their servers).
// - Excluded from CsrfMiddleware (app.module.ts configure()).
// - rawBody: true (main.ts) — reads req.rawBody for HMAC verification.
// - Fail-closed: invalid signature → 401, never processes payload.
//
// IP RATE LIMIT (Phase-7 Wave 2 security hardening, AC-58): WebhookIpRateLimitGuard is a
// PRE-CHECK — runs before signature verification, throttles by source IP alone,
// independent of whether the signature is ultimately valid. FAILS OPEN on a Redis error
// (see guard file header) because HMAC verification below remains the primary control.
//
// SIGNATURE FRESHNESS WINDOW (AC-59 / P6 M-3 "check Razorpay"): Razorpay's webhook
// scheme has no dedicated timestamp HEADER (unlike Svix) — but the JSON body itself
// (covered by the HMAC) carries a top-level `created_at` Unix-seconds field on standard
// webhook payloads. When present, a validly-signed-but-STALE payload is rejected
// (anti-replay). When absent, the check is skipped — a documented limitation, not a
// bypass of the primary HMAC control.

import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { WebhookIpRateLimitGuard } from "../../common/rate-limit/webhook-ip-rate-limit.guard";
import { isWithinSignatureFreshnessWindow } from "../../common/webhook/signature-freshness";
import { validateEnv } from "../../config/env";
import { CommerceService } from "./commerce.service";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./providers/payment/payment-provider.interface";

@Controller("commerce/payments/webhook")
@UseGuards(WebhookIpRateLimitGuard)
export class WebhookController {
  constructor(
    private readonly commerceService: CommerceService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * POST /api/v1/commerce/payments/webhook
   *
   * 1. Reads raw body from req.rawBody (Buffer — requires rawBody: true in main.ts).
   * 2. Verifies X-Razorpay-Signature HMAC — FAIL CLOSED (401 on invalid/missing secret).
   * 3. Rejects a stale (but validly-signed) payload outside the freshness window.
   * 4. Enqueues (or synchronously processes) the webhook event idempotently.
   */
  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-razorpay-signature") signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException({
        code: "commerce.webhook_raw_body_missing",
        title: "Raw body unavailable",
        detail: "rawBody: true must be set in NestFactory.create() options in main.ts.",
      });
    }

    if (!signature) {
      throw new UnauthorizedException({
        code: "commerce.webhook_missing_signature",
        title: "Webhook signature missing",
        detail: "X-Razorpay-Signature header is required.",
      });
    }

    // FAIL CLOSED: signature verification
    const verified = this.paymentProvider.verifyWebhookSignature({
      rawBody,
      signature,
    });

    if (!verified) {
      throw new UnauthorizedException({
        code: "commerce.webhook_invalid_signature",
        title: "Webhook signature invalid",
        detail: "HMAC verification failed. Possible forgery or misconfigured RAZORPAY_WEBHOOK_SECRET.",
      });
    }

    // FRESHNESS WINDOW — see file header for the Razorpay-specific rationale.
    const parsedBody = req.body as Record<string, unknown> | undefined;
    const createdAt =
      typeof parsedBody?.["created_at"] === "number" ? (parsedBody["created_at"] as number) : undefined;
    if (createdAt !== undefined) {
      const env = validateEnv();
      if (!isWithinSignatureFreshnessWindow(createdAt, env.WEBHOOK_SIGNATURE_MAX_AGE_SECONDS)) {
        throw new UnauthorizedException({
          code: "commerce.webhook_stale_signature",
          title: "Webhook signature stale",
          detail: "The webhook payload's created_at timestamp is outside the allowed freshness window.",
        });
      }
    }

    // Process idempotently (never inline — always via the seam)
    await this.commerceService.enqueueWebhookEvent(req.body as Record<string, unknown>);

    return { received: true };
  }
}
