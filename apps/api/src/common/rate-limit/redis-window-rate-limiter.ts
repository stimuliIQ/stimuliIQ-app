// apps/api/src/common/rate-limit/redis-window-rate-limiter.ts
//
// GENERALIZED core of the fixed-window Redis rate-limit pattern already used three
// times in this codebase (Phase-7 Wave 2 task #M-6, "IP-dimension rate limiting"):
//   - apps/api/src/modules/auth/lib/login-rate-limiter.ts        (account-keyed, fail-open by omission)
//   - apps/api/src/modules/leads/lib/public-booking-rate-limiter.ts (IP-keyed, fail-CLOSED)
//   - apps/api/src/modules/health/guards/health-rate-limit.guard.ts (IP-keyed, fail-OPEN)
//
// Rather than adding a throttler package (@nestjs/throttler) or duplicating the
// incr/expire/fail-mode logic a fourth and fifth time, this module extracts the shared
// "increment a counter, set TTL on first hit, compare to a max, decide fail-open vs
// fail-closed on a Redis error" logic into one small, directly-testable function. The
// three EXISTING limiter files above are left untouched (they are stable, already
// tested, and low-risk to leave as-is) — this helper is consumed by the NEW per-IP
// limiters added this wave (auth-ip-rate-limit.guard.ts, webhook-ip-rate-limit.guard.ts)
// so those two new call sites share one tested implementation instead of a third/fourth
// copy-paste.
//
// FAIL-OPEN vs FAIL-CLOSED is the caller's explicit choice (`failClosed` option) — see
// each call site for the documented rationale for its choice.

import type { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";

export interface WindowRateLimitOptions {
  /** Fixed window size, in seconds, for the counter's TTL. */
  windowSeconds: number;
  /** Requests beyond this count within the window are rate-limited. */
  maxAttempts: number;
  /**
   * true  = FAIL CLOSED: a Redis error is treated as "rate-limited" (reject the request).
   *         Use for surfaces with no other abuse control (credential-stuffing, unauth
   *         writes) where losing the limiter even briefly is worse than a false-positive
   *         rejection.
   * false = FAIL OPEN: a Redis error is treated as "not rate-limited" (allow through).
   *         Use for surfaces that already have a primary control (e.g. HMAC signature
   *         verification on a webhook) where this limiter is defense-in-depth, and
   *         blocking legitimate traffic during a transient Redis blip is the worse
   *         outcome (matches health-rate-limit.guard.ts's documented reasoning).
   */
  failClosed: boolean;
}

/**
 * Result of a single rate-limit check.
 * `limited` — true if the caller should reject this request.
 * `retryAfterSeconds` — value to surface in a `Retry-After` response header.
 */
export interface WindowRateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

/**
 * Increments the fixed-window counter for `key` and reports whether the caller is
 * currently over `maxAttempts` within the trailing `windowSeconds`. On the FIRST
 * increment in a new window, sets the key's TTL to `windowSeconds` (classic
 * fixed-window counter — matches the three existing hand-rolled limiters exactly).
 *
 * NEVER throws — a Redis error is converted to `options.failClosed` per the caller's
 * documented choice, and (if a logger is supplied) logged without leaking any request
 * body/secret (only the redacted `key` and the error's string form are logged).
 */
export async function hitRedisWindow(
  redis: Redis,
  key: string,
  options: WindowRateLimitOptions,
  logger?: Logger,
): Promise<WindowRateLimitResult> {
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, options.windowSeconds);
    }
    return {
      limited: count > options.maxAttempts,
      retryAfterSeconds: options.windowSeconds,
    };
  } catch (err) {
    logger?.error(
      `[RedisWindowRateLimiter] Redis error for key "${key}" — failing ${
        options.failClosed ? "CLOSED (rate-limited)" : "OPEN (allowed through)"
      }: ${String(err)}`,
    );
    return { limited: options.failClosed, retryAfterSeconds: options.windowSeconds };
  }
}
