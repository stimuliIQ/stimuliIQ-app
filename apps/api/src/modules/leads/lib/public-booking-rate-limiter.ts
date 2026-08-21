// apps/api/src/modules/leads/lib/public-booking-rate-limiter.ts
//
// Fixed-window rate limit for the UNAUTHENTICATED public booking intake endpoint
// (docs/plans/phase-2.md task #6: "rate-limited (reuse login-rate-limiter pattern or
// simple per-IP limiter)"). Keyed by client IP — blunts scripted lead-spam against a
// route that has no auth boundary by design (it exists specifically so anonymous site
// visitors can self-book a demo slot).
//
// H-1 FIX: Fail-closed on Redis errors.
// If the Redis incr/expire throws (network blip, Redis restart, etc.), we treat the
// request as rate-limited and reject it rather than allowing it through.
// The only unauthenticated write endpoint MUST NOT lose its abuse control on a Redis
// blip. The error is logged so ops can act on it without silently dropping the limit.
//
// TODO (tenant ceiling): add a second bucket keyed by tenant_id (N public bookings/min
// per tenant) so a botnet across many IPs can't create unbounded rows per tenant.
// Not implemented here to avoid scope creep — tracked in docs/phase-2-followups.md.

import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../redis/redis.service";

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 5;

function key(ip: string): string {
  return `public:bookings:rl:${ip}`;
}

@Injectable()
export class PublicBookingRateLimiter {
  private readonly logger = new Logger(PublicBookingRateLimiter.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Increments the attempt counter and returns true if the caller is currently rate-limited.
   *
   * FAIL-CLOSED: if the Redis call throws for any reason (network blip, Redis unavailable,
   * etc.) this method returns true (rate-limited) rather than false (allow-through).
   * Rationale: this is the ONLY unauthenticated write path; losing rate-limit protection
   * even briefly is worse than briefly rejecting legitimate traffic.
   */
  async hit(ip: string): Promise<boolean> {
    const k = key(ip);
    try {
      const count = await this.redis.client.incr(k);
      if (count === 1) {
        await this.redis.client.expire(k, WINDOW_SECONDS);
      }
      return count > MAX_ATTEMPTS;
    } catch (err) {
      // H-1: Fail CLOSED — treat Redis error as rate-limited to preserve abuse protection.
      this.logger.error(
        `[PublicBookingRateLimiter] Redis error for key ${k}. Failing closed (treating as rate-limited): ${String(err)}`,
      );
      return true;
    }
  }
}
