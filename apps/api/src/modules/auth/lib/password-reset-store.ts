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

function tokenKey(tokenHash: string): string {
  return `auth:password-reset:${tokenHash}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class PasswordResetStore {
  constructor(private readonly redis: RedisService) {}

  /** Issues a new single-use token for `userId`. Returns the PLAINTEXT token (only ever handed to MailProvider, never persisted). */
  async issue(userId: string): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    await this.redis.client.set(tokenKey(hashToken(token)), userId, "EX", TOKEN_TTL_SECONDS);
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
