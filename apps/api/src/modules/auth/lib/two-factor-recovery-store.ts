// apps/api/src/modules/auth/lib/two-factor-recovery-store.ts
//
// Single-use, expiring, attempt-capped email-OTP storage for the 2FA recovery flow.
// Redis-backed, which is the CORRECT durability choice here (unlike two-factor-store.ts's
// active TOTP secret — see that file's header): a recovery code is a genuinely
// short-lived credential, and losing one to an eviction just means "request another".
//
// Only the SHA-256 hash of the code is ever stored — never the plaintext (same
// convention as otp-store.ts and password-reset-store.ts).
//
// WHY AN ATTEMPT CAP IS LOAD-BEARING HERE
// A 6-digit code is only ~20 bits. Over a 15-minute window an attacker who already holds
// the password could otherwise walk the whole space. `verify()` therefore burns the code
// after MAX_ATTEMPTS failures, so the search is capped at 5 guesses per issued code
// rather than 1,000,000 — and re-issuing is itself rate-limited a layer up, in
// TwoFactorRecoveryService.

import { Injectable } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import { RedisService } from "../../../redis/redis.service";

const CODE_TTL_SECONDS = 15 * 60; // 15 minutes — long enough for email delivery lag.
const MAX_ATTEMPTS = 5;

function codeKey(userId: string): string {
  return `auth:2fa-recovery:${userId}`;
}
function attemptsKey(userId: string): string {
  return `auth:2fa-recovery:attempts:${userId}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

@Injectable()
export class TwoFactorRecoveryStore {
  constructor(private readonly redis: RedisService) {}

  /**
   * Issues a fresh 6-digit code for `userId`, replacing any outstanding one and resetting
   * the attempt counter. Returns the PLAINTEXT code — handed straight to MailProvider and
   * never persisted in that form.
   */
  async issue(userId: string): Promise<{ code: string; expiresInMinutes: number }> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const pipeline = this.redis.client.multi();
    pipeline.set(codeKey(userId), hashCode(code), "EX", CODE_TTL_SECONDS);
    pipeline.del(attemptsKey(userId));
    await pipeline.exec();
    return { code, expiresInMinutes: CODE_TTL_SECONDS / 60 };
  }

  /**
   * Verifies + CONSUMES the code. Returns false for "no code outstanding", "expired",
   * "wrong", and "attempt cap burnt" alike — the caller maps every one of those to the
   * SAME generic error so the response never distinguishes them.
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const storedHash = await this.redis.client.get(codeKey(userId));
    if (!storedHash) return false;

    const attempts = await this.redis.client.incr(attemptsKey(userId));
    if (attempts > MAX_ATTEMPTS) {
      await this.invalidate(userId);
      return false;
    }

    const matches = storedHash === hashCode(code);
    if (matches) await this.invalidate(userId); // single-use.
    return matches;
  }

  async invalidate(userId: string): Promise<void> {
    const pipeline = this.redis.client.multi();
    pipeline.del(codeKey(userId));
    pipeline.del(attemptsKey(userId));
    await pipeline.exec();
  }
}
