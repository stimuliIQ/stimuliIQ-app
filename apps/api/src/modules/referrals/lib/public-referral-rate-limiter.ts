// apps/api/src/modules/referrals/lib/public-referral-rate-limiter.ts
//
// Fixed-window per-IP rate limit for the UNAUTHENTICATED referral-redeem endpoint
// (POST /public/referrals/redeem). Mirrors leads/lib/public-booking-rate-limiter.ts
// exactly (same Redis fixed-window, same fail-closed semantics).
//
// SECURITY (Wave 6 M2): redeem accepts a referral `code` and attaches it to a lead.
// Without a limiter an attacker can enumerate valid referral codes (brute-force the
// 40-char code space) and spam attribution writes. Keyed by client IP, separate key
// namespace from bookings so the two counters never interfere.
//
// FAIL-CLOSED: a Redis error is treated as rate-limited (reject), never allow-through —
// this is an unauthenticated write path and must not lose its abuse control on a blip.

import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../redis/redis.service";

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 10;

function key(ip: string): string {
  return `public:referrals:redeem:rl:${ip}`;
}

@Injectable()
export class PublicReferralRateLimiter {
  private readonly logger = new Logger(PublicReferralRateLimiter.name);

  constructor(private readonly redis: RedisService) {}

  /** Increments the per-IP counter; returns true if the caller is currently rate-limited. */
  async hit(ip: string): Promise<boolean> {
    const k = key(ip);
    try {
      const count = await this.redis.client.incr(k);
      if (count === 1) {
        await this.redis.client.expire(k, WINDOW_SECONDS);
      }
      return count > MAX_ATTEMPTS;
    } catch (err) {
      this.logger.error(
        `[PublicReferralRateLimiter] Redis error for key ${k}. Failing closed (treating as rate-limited): ${String(err)}`,
      );
      return true;
    }
  }
}
