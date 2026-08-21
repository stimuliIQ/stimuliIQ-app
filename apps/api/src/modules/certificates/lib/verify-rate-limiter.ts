// apps/api/src/modules/certificates/lib/verify-rate-limiter.ts
//
// Fixed-window rate limit for the PUBLIC, UNAUTHENTICATED certificate verify
// endpoint (GET /verify/:certUid). Keyed by client IP — prevents enumeration
// attacks and brute-force signature guessing against the public endpoint.
//
// Mirrors the PublicBookingRateLimiter pattern exactly (apps/api/src/modules/leads/lib/).
//
// Configuration:
//   VERIFY_RL_WINDOW_S  — window in seconds (default: 60)
//   VERIFY_RL_MAX_HITS  — max requests per IP per window (default: 20)
//
// FAIL-CLOSED: if the Redis call throws, we treat the request as rate-limited
// and reject it (same rationale as PublicBookingRateLimiter). The only
// unauthenticated read path must maintain enumeration-resistance even on
// transient Redis errors.
//
// AC-H6 (spec): 429 + Retry-After header when threshold exceeded.
// AC-H3/H4: signature check happens before DB lookup, so enumeration only
// costs a signature-recompute (cheap HMAC), not a DB round-trip.

import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../redis/redis.service";

// Allow env override for the window and threshold (AC-H6: "configured via env variable").
const WINDOW_SECONDS = parseInt(process.env["VERIFY_RL_WINDOW_S"] ?? "60", 10) || 60;
const MAX_HITS = parseInt(process.env["VERIFY_RL_MAX_HITS"] ?? "20", 10) || 20;

function redisKey(ip: string): string {
  return `public:verify:rl:${ip}`;
}

@Injectable()
export class VerifyRateLimiter {
  private readonly logger = new Logger(VerifyRateLimiter.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Increments the IP counter and returns true if the IP is currently rate-limited.
   *
   * FAIL-CLOSED: Redis errors return true (rate-limited) to preserve enumeration
   * protection. The error is logged; ops should investigate Redis health.
   *
   * @returns true  → caller should return 429 (with Retry-After: WINDOW_SECONDS header).
   *          false → request is within limits; proceed.
   */
  async hit(ip: string): Promise<boolean> {
    const k = redisKey(ip);
    try {
      const count = await this.redis.client.incr(k);
      if (count === 1) {
        await this.redis.client.expire(k, WINDOW_SECONDS);
      }
      return count > MAX_HITS;
    } catch (err) {
      // Fail CLOSED — treat Redis error as rate-limited (AC-H6 enumeration guard).
      this.logger.error(
        `[VerifyRateLimiter] Redis error for key ${k}, failing closed: ${String(err)}`,
      );
      return true;
    }
  }

  /** Remaining TTL in seconds for a given IP (for Retry-After header). */
  get retryAfterSeconds(): number {
    return WINDOW_SECONDS;
  }
}
