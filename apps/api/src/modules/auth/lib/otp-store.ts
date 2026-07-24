// apps/api/src/modules/auth/lib/otp-store.ts
//
// OTP code storage + rate-limiting, backed by Redis (CLAUDE.md §1: "Redis for cache +
// sessions"). The code itself is generated and verified for real (per the locked
// decision); only the SMS *send* is stubbed (see providers/sms). Codes are stored
// HASHED (sha256) with a TTL — never the plaintext code.
//
// RATE-LIMIT DIMENSION (Wave 6 security audit, comment/behavior drift fix): request
// rate is currently capped per PHONE ONLY (see `rateLimitKey`/`attemptsKey` below, both
// keyed solely on `phone`) — there is no IP dimension yet. A prior version of this
// comment claimed "per phone+IP", which was never implemented; that was a doc bug, not
// a behavior change here. Adding a real IP dimension (so a single attacker IP can't
// hammer many phone numbers, and so legitimate shared-NAT users aren't penalized for
// each other) is tracked as a follow-up (reviewer's M-6, "IP-dimension rate limiting")
// — intentionally out of scope for this fix.

import { Injectable } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { RedisService } from "../../../redis/redis.service";

const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const OTP_REQUEST_WINDOW_SECONDS = 60; // 1 request per phone per 60s
const OTP_MAX_ATTEMPTS = 5; // verify attempts before the code is invalidated

function otpKey(phone: string): string {
  return `auth:otp:${phone}`;
}
function rateLimitKey(phone: string): string {
  return `auth:otp:rl:${phone}`;
}
function attemptsKey(phone: string): string {
  return `auth:otp:attempts:${phone}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

@Injectable()
export class OtpStore {
  constructor(private readonly redis: RedisService) {}

  /** Generates a 6-digit code, stores its hash with a TTL, and resets attempt counters. Returns the plaintext code (caller hands it to SmsProvider; never persisted in plaintext). */
  async issue(phone: string): Promise<{ code: string; expiresInSeconds: number }> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const pipeline = this.redis.client.multi();
    pipeline.set(otpKey(phone), hashCode(code), "EX", OTP_TTL_SECONDS);
    pipeline.del(attemptsKey(phone));
    await pipeline.exec();
    return { code, expiresInSeconds: OTP_TTL_SECONDS };
  }

  /** Returns true if a request was already issued within the rate-limit window (caller should reject with 429). */
  async isRateLimited(phone: string): Promise<boolean> {
    const exists = await this.redis.client.exists(rateLimitKey(phone));
    return exists === 1;
  }

  async markRequested(phone: string): Promise<void> {
    await this.redis.client.set(rateLimitKey(phone), "1", "EX", OTP_REQUEST_WINDOW_SECONDS);
  }

  /**
   * Verifies `code` against the stored hash. Increments an attempt counter and
   * invalidates the code after `OTP_MAX_ATTEMPTS` failed tries (defense against
   * brute force) or after a successful verify (single-use).
   */
  async verify(phone: string, code: string): Promise<boolean> {
    const storedHash = await this.redis.client.get(otpKey(phone));
    if (!storedHash) return false;

    const attempts = await this.redis.client.incr(attemptsKey(phone));
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.invalidate(phone);
      return false;
    }

    const matches = storedHash === hashCode(code);
    if (matches) {
      await this.invalidate(phone); // single-use
    }
    return matches;
  }

  async invalidate(phone: string): Promise<void> {
    const pipeline = this.redis.client.multi();
    pipeline.del(otpKey(phone));
    pipeline.del(attemptsKey(phone));
    await pipeline.exec();
  }
}
