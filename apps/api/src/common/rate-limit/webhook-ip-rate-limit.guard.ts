// apps/api/src/common/rate-limit/webhook-ip-rate-limit.guard.ts
//
// IP-DIMENSION rate limit for UNAUTHENTICATED webhook routes (Phase-6 followups M-3 /
// Phase-7 Wave 2 security hardening batch A, AC-58): "Webhook endpoints are rate-limited
// per source IP ... independent of HMAC signature validity (the rate limit is a
// pre-check)."
//
// Applied to:
//   - POST /commerce/payments/webhook          (WebhookController, Razorpay)
//   - POST /campaigns/webhooks/:channel         (CampaignWebhookController, email/whatsapp)
//
// This guard runs BEFORE the controller reads the raw body or calls
// `verifyWebhookSignature()` — it is a pre-check independent of signature validity, so a
// flood of requests (valid-signature or not) from one source IP is throttled either way.
//
// KEY SHAPE: `webhook:ip-rl:<ControllerClassName>:<ip>` — bucketed per CONTROLLER CLASS
// (not per handler method, since each webhook controller currently exposes exactly one
// POST handler; using the class name keeps the key stable even if a controller gains a
// second route later without silently sharing another route's key).
//
// FAIL-OPEN (documented choice, item 1 of the Wave 2 security hardening batch): if Redis
// is unreachable, this guard allows the request through rather than rejecting it.
// Rationale: unlike the auth IP guard (which is the FIRST and only line of defense
// against distributed credential-stuffing), every webhook route behind this guard has a
// PRIMARY authentication control immediately downstream — HMAC signature verification,
// which is fail-closed on its own (see razorpay-payment.provider.ts / resend-mail.
// provider.ts / whatsapp-cloud.provider.ts `verifyWebhookSignature()`). A Redis outage
// must not additionally block legitimate payment-captured or delivery-receipt webhooks
// (which providers retry on a schedule, but delaying them delays invoice generation /
// suppression-list updates) when the real authentication boundary is unaffected and
// still fully enforced. This mirrors health-rate-limit.guard.ts's fail-open reasoning:
// this guard is defense-in-depth, not the primary control, for this specific route group.

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { RedisService } from "../../redis/redis.service";
import { validateEnv } from "../../config/env";
import { hitRedisWindow } from "./redis-window-rate-limiter";

@Injectable()
export class WebhookIpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(WebhookIpRateLimitGuard.name);

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = req.ip ?? "unknown";
    const bucket = context.getClass().name; // e.g. "WebhookController" | "CampaignWebhookController"
    const env = validateEnv();

    const { limited, retryAfterSeconds } = await hitRedisWindow(
      this.redis.client,
      `webhook:ip-rl:${bucket}:${ip}`,
      {
        windowSeconds: env.WEBHOOK_IP_RATE_LIMIT_WINDOW_SECONDS,
        maxAttempts: env.WEBHOOK_IP_RATE_LIMIT_MAX_ATTEMPTS,
        failClosed: false, // see file header — FAIL OPEN
      },
      this.logger,
    );

    if (limited) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      throw new HttpException(
        {
          code: "webhook.ip_rate_limited",
          title: "Too many requests",
          detail: "Rate limit exceeded for this source IP. Retry after the configured window.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
