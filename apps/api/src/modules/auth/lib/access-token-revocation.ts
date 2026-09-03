// apps/api/src/modules/auth/lib/access-token-revocation.ts
//
// Makes "revoke every session for this user" actually revoke the ACCESS token too.
//
// THE GAP THIS CLOSES. `AuthRepository.revokeAllSessionsForUser` stamps `revokedAt` on
// the `sessions` rows, and the sessions table is consulted on exactly one path: the
// refresh rotation. The access token carries only `sub`, `tenant_id` and `roles` — no
// session id — and `resolveRequestUser` never looked at `sessions` at all. So an attacker
// holding a stolen access token kept full API access for the remainder of its 15-minute
// life AFTER the victim changed their password, reset it, recovered from a lost 2FA
// device, or an admin rotated the credential precisely because it was compromised.
// Revocation that leaves the stolen half working is half a revocation.
//
// HOW. One key per user recording the instant their credentials were invalidated. Any
// access token issued BEFORE that instant is refused. `iat` is already on every token, so
// nothing about the token shape changes and existing tokens keep verifying.
//
// WHY NOT A PER-SESSION KEY. The access token has no `sid` to key on, and adding one
// would only cover sessions minted after the deploy. A per-user epoch covers every token
// already in the wild the moment it is written, which is the property that matters during
// an incident.
//
// TTL. The key is only useful while a token issued before it could still be unexpired, so
// it expires with the access-token lifetime plus a margin for clock skew. Nothing
// accumulates.
//
// FAIL OPEN, LOUDLY. If Redis is unreachable the check is skipped and the failure is
// logged at error level. This is deliberate and is not the same trade-off the rate
// limiters make (they fail CLOSED, because there "closed" means one request is refused).
// Here "closed" would mean every signed-in user in the product is logged out by a Redis
// hiccup — an availability incident far worse than the ≤15-minute window this narrows,
// and the behaviour without this file is "no check at all" anyway. So a Redis outage
// degrades to exactly the previous behaviour rather than to an outage of its own.

import { Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { RedisService } from "../../../redis/redis.service";

/**
 * Access-token lifetime plus a margin. `JWT_ACCESS_TTL` is configurable but is measured
 * in minutes by every deployment; an hour comfortably covers it and clock skew, and the
 * cost of over-keeping is one small string per credential rotation.
 */
const REVOCATION_TTL_SECONDS = 60 * 60;

function revocationKey(userId: string): string {
  return `auth:revoked-before:${userId}`;
}

@Injectable()
export class AccessTokenRevocationStore {
  private readonly logger = new Logger(AccessTokenRevocationStore.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Marks every access token issued up to now as no longer valid for this user.
   *
   * Stored as whole seconds to match a JWT's `iat`, which is also whole seconds — a
   * millisecond value would be compared against a truncated `iat` and the comparison
   * would mean something slightly different every time.
   */
  async revokeAllBefore(userId: string, now: Date = new Date()): Promise<void> {
    const epochSeconds = Math.floor(now.getTime() / 1000);
    try {
      await this.redis.client.set(revocationKey(userId), String(epochSeconds), "EX", REVOCATION_TTL_SECONDS);
    } catch (err) {
      // The session rows are already revoked, so refresh is dead either way and the
      // exposure is bounded by the access-token TTL. Never fail the caller's action —
      // a password reset that 500s because Redis blinked is worse than this window.
      this.logger.error(
        `[AccessTokenRevocation] could not stamp revocation for userId=${userId}; ` +
          `access tokens already issued stay valid until they expire: ${String(err)}`,
      );
    }
  }

  /**
   * True when a token with this `iat` was issued STRICTLY before the user's credentials
   * were invalidated. `iat` missing (impossible for a token this service signs) is treated
   * as revoked — a token that cannot prove when it was minted cannot prove it is current.
   *
   * STRICTLY, because `iat` is whole seconds and the very next thing that happens after a
   * password change is the client signing back in: that new token is minted in the same
   * second as the revocation, and `<=` would refuse it, bouncing the user straight back to
   * the login screen they just came from. A token minted in the same second as the
   * revocation is the replacement session — the attacker's was minted earlier, and still
   * fails.
   */
  async isRevoked(userId: string, issuedAtSeconds: number | undefined): Promise<boolean> {
    let raw: string | null;
    try {
      raw = await this.redis.client.get(revocationKey(userId));
    } catch (err) {
      this.logger.error(
        `[AccessTokenRevocation] revocation check unavailable for userId=${userId}, allowing the request: ${String(err)}`,
      );
      return false;
    }
    if (raw === null) return false;

    const revokedBefore = Number(raw);
    if (!Number.isFinite(revokedBefore)) return false;
    if (issuedAtSeconds === undefined) return true;
    return issuedAtSeconds < revokedBefore;
  }

  /** Test seam — the raw client, so specs can assert the key without reaching into Redis' internals. */
  get client(): Redis {
    return this.redis.client;
  }
}
