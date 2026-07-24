// apps/api/src/modules/auth/guards/auth-ip-rate-limit.guard.ts
//
// IP-DIMENSION rate limit for the credential-guessing surface (Phase-0 followups M-6 /
// Phase-7 Wave 2 security hardening batch A, AC-57): "No IP-dimension rate limiting —
// current rate limiting is keyed by account/identifier; an IP-based dimension is needed
// to slow down distributed credential-stuffing across many accounts from one source."
//
// Existing account-keyed limiters (LoginRateLimiter keyed by email, OtpStore keyed by
// phone) are UNCHANGED by this guard — they remain the first line of defense per-account.
// This guard adds the missing SECOND dimension: a single attacking IP that spreads its
// attempts across many different target accounts/phones (so no single account ever
// trips its own limiter) is now still throttled, because every attempt from that IP
// counts against the SAME per-IP-per-route bucket regardless of which account/phone it
// targets.
//
// Applied to: POST /auth/login, POST /auth/otp/request, POST /auth/otp/verify, and
// POST /auth/refresh (see auth.controller.ts). NOT applied to /auth/logout — that route
// degrades to a no-op when no valid refresh-token cookie is presented, so it is not a
// meaningful abuse surface.
//
// /auth/refresh was ADDED to this guard by T5/R6 (docs/plans/phase-9-completion.md):
// unlike /auth/logout, refresh performs a real DB lookup (session by refresh-token hash)
// PLUS a token-rotation write on every call — even though it already requires a
// refresh-token cookie, an attacker holding (or brute-forcing) refresh-token guesses, or
// simply hammering the endpoint with garbage cookies to force DB round-trips, was an
// unthrottled resource-exhaustion surface. It shares this guard's generic per-route
// bucket (`refresh`), independent of the login/OTP buckets.
//
// KEY SHAPE: `auth:ip-rl:<handlerName>:<ip>` — bucketed per ROUTE (handler method name)
// so a flood against /auth/otp/request cannot consume the budget meant for
// /auth/login, and vice versa, while still sharing one guard implementation.
//
// FAIL-CLOSED (documented choice, item 1 of the Wave 2 security hardening batch): if
// Redis is unreachable, this guard treats the request as rate-limited (429) rather than
// allowing it through. Rationale: unlike the webhook IP guard (which has a PRIMARY
// authentication control — HMAC signature verification — backing it up), this route
// group has NO secondary control once past this guard other than the account-keyed
// limiter (which a distributed attacker is specifically trying to stay under). Losing
// this limiter during a Redis outage would fully reopen the distributed credential-
// stuffing gap this guard exists to close, so a fail-open default is not acceptable
// here (mirrors public-booking-rate-limiter.ts's fail-closed rationale, the only other
// unauthenticated-write-adjacent limiter in this codebase).

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { RedisService } from "../../../redis/redis.service";
import { validateEnv } from "../../../config/env";
import { hitRedisWindow } from "../../../common/rate-limit/redis-window-rate-limiter";

@Injectable()
export class AuthIpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AuthIpRateLimitGuard.name);

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = req.ip ?? "unknown";
    const bucket = context.getHandler().name; // e.g. "login" | "requestOtp" | "verifyOtp"
    const env = validateEnv();

    const { limited, retryAfterSeconds } = await hitRedisWindow(
      this.redis.client,
      `auth:ip-rl:${bucket}:${ip}`,
      {
        windowSeconds: env.AUTH_IP_RATE_LIMIT_WINDOW_SECONDS,
        maxAttempts: env.AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS,
        failClosed: true, // see file header — FAIL CLOSED
      },
      this.logger,
    );

    if (limited) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      throw new HttpException(
        {
          code: "auth.ip_rate_limited",
          title: "Too many requests",
          detail: "Rate limit exceeded for this source IP. Retry after the configured window.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
