// apps/api/src/modules/auth/lib/password-reset-store.ts
//
// Single-use, expiring password-reset token storage (T28 / B9, docs/plans/
// phase-9-completion.md), backed by Redis — mirrors otp-store.ts's convention exactly
// (a genuinely SHORT-LIVED, single-use credential is the correct Redis use case, unlike
// two-factor-store.ts's TOTP secret, which needs to be durable — see that file's header).
//
// The token itself is a high-entropy random value; only its SHA-256 hash is ever stored
// (never the plaintext token) — same pattern as OTP codes.

import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { RedisService } from "../../../redis/redis.service";

const TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes.
const TOKEN_BYTES = 32;

/**
 * TTL for a link a STAFF MEMBER issued on a student's behalf ("Resend LMS credentials"),
 * as opposed to one the user asked for themselves seconds earlier.
 *
 * The 30-minute default is right for self-service: the visitor is sitting at the form and
 * will open the mail immediately. A staff-issued link is different — nobody told the
 * student it was coming, so it is normal for them to read it that evening. Expiring it in
 * half an hour turns a deliberate staff action into a dead link and a second support
 * request. A day is still short enough to be worthless if the mailbox is breached later,
 * and the token remains single-use and high-entropy either way.
 */
export const STAFF_ISSUED_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours.

function tokenKey(tokenHash: string): string {
  return `auth:password-reset:${tokenHash}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class PasswordResetStore {
  constructor(private readonly redis: RedisService) {}

  /**
   * Issues a new single-use token for `userId`. Returns the PLAINTEXT token (only ever
   * handed to MailProvider, never persisted).
   *
   * `ttlSeconds` defaults to the 30-minute self-service lifetime; pass
   * `STAFF_ISSUED_TOKEN_TTL_SECONDS` for a link staff sent on the user's behalf (see that
   * constant). Nothing else about the token changes with the TTL — same entropy, same
   * hash-only storage, same single use.
   */
  async issue(userId: string, ttlSeconds: number = TOKEN_TTL_SECONDS): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    await this.redis.client.set(tokenKey(hashToken(token)), userId, "EX", ttlSeconds);
    return token;
  }

  /** Verifies + CONSUMES (single-use) a token. Returns the userId it was issued for, or null if invalid/expired/already used. */
  async consume(token: string): Promise<string | null> {
    const key = tokenKey(hashToken(token));
    const userId = await this.redis.client.get(key);
    if (!userId) return null;
    await this.redis.client.del(key); // single-use — consumed regardless of what the caller does next.
    return userId;
  }
}
