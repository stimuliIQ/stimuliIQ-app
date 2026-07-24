// apps/api/src/modules/health/guards/health-rate-limit.guard.ts
//
// AC-49: `/health` and `/health/ready` are exempt from auth but still rate-limited —
// unbounded unauthenticated traffic must not be able to flood logs / consume resources.
// Fixed-window counter keyed by source IP, same shape as
// modules/leads/lib/public-booking-rate-limiter.ts / modules/auth/lib/login-rate-limiter.ts.
//
// DELIBERATE DEVIATION from those two guards' fail-CLOSED-on-Redis-error pattern: this
// guard fails OPEN. Those two gate a WRITE/credential path where losing the limiter
// even briefly is worse than rejecting legitimate traffic. This gates a READ-ONLY
// diagnostic probe whose entire purpose is to surface a Redis outage — HealthService's
// readiness check already independently reports `redis: "down"` in that exact scenario.
// Blocking the probe here (fail-closed) would hide the very signal an on-call engineer
// needs most during a Redis incident, so a Redis error at the rate-limit layer allows
// the request through instead.

import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { RedisService } from "../../../redis/redis.service";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 120; // generous: load balancers/uptime monitors poll every few seconds

function key(ip: string): string {
  return `health:rl:${ip}`;
}

@Injectable()
export class HealthRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? "unknown";

    try {
      const k = key(ip);
      const count = await this.redis.client.incr(k);
      if (count === 1) {
        await this.redis.client.expire(k, WINDOW_SECONDS);
      }
      if (count > MAX_REQUESTS_PER_WINDOW) {
        throw new HttpException(
          {
            code: "health.rate_limited",
            title: "Too many requests",
            detail: "Health check rate limit exceeded. Retry after the configured window.",
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      // Fail OPEN — see file header. A Redis blip must never itself hide a
      // dependency-down signal from an on-call engineer polling /health/ready.
      return true;
    }
  }
}
