// apps/api/src/modules/auth/lib/login-rate-limiter.ts
//
// Simple fixed-window rate limit for password login attempts, backed by Redis
// (docs/04 §7 security checklist: "rate limiting"). Keyed by email — blunts
// credential-stuffing without needing a dedicated throttler package for Phase 0.

import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../redis/redis.service";

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 10;

function key(email: string): string {
  return `auth:login:rl:${email.toLowerCase()}`;
}

@Injectable()
export class LoginRateLimiter {
  constructor(private readonly redis: RedisService) {}

  /** Increments the attempt counter and returns true if the caller is currently rate-limited. */
  async hit(email: string): Promise<boolean> {
    const k = key(email);
    const count = await this.redis.client.incr(k);
    if (count === 1) {
      await this.redis.client.expire(k, WINDOW_SECONDS);
    }
    return count > MAX_ATTEMPTS;
  }

  async reset(email: string): Promise<void> {
    await this.redis.client.del(key(email));
  }
}
