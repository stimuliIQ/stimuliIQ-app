// apps/api/src/modules/auth/lib/two-factor-store.ts
//
// 2FA (TOTP) secret + backup-code storage (T28, docs/plans/phase-9-completion.md).
//
// DURABILITY (hardening follow-up — resolved): the ACTIVE TOTP secret and the hashed,
// single-use backup codes are persisted in Postgres (`two_factor_credentials`), NOT
// Redis. Redis here is a cache/rate-limit/OTP layer — never a durable system-of-record —
// so a flush/eviction would have silently locked out every enrolled user. Only the
// short-lived ENROLLMENT-IN-PROGRESS secret stays in Redis (TTL'd, 10 min); it is
// worthless until the user proves possession by verifying, so losing it just means
// "start enrolment again".
//
// SECURITY: the active TOTP secret is ENVELOPE-ENCRYPTED at rest with AES-256-GCM (M4,
// see two-factor-crypto.ts) — a DB dump alone never yields a usable secret. The secret
// is never logged. Backup codes are stored HASHED (sha256), never in plaintext (mirrors
// otp-store.ts's hashCode convention). The `two_factor_credentials` row is deliberately
// NOT audited (see soft-delete.extension.ts) — a credential must never be
// before/after-snapshotted into audit_logs.

import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { RedisService } from "../../../redis/redis.service";
import { PrismaService } from "../../../prisma/prisma.service";
import { encryptTwoFactorSecret, decryptTwoFactorSecret } from "./two-factor-crypto";

const PENDING_TTL_SECONDS = 10 * 60; // 10 minutes to complete enrollment.
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I.
const BACKUP_CODE_LENGTH = 10;

function pendingKey(userId: string): string {
  return `auth:2fa:pending:${userId}`;
}

function hashBackupCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateBackupCode(): string {
  const bytes = randomBytes(BACKUP_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    out += BACKUP_CODE_ALPHABET[bytes[i]! % BACKUP_CODE_ALPHABET.length];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

@Injectable()
export class TwoFactorStore {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Enrollment-in-progress secret (Redis, TTL'd — transient by design) ──────────

  async setPendingSecret(userId: string, secret: string): Promise<void> {
    await this.redis.client.set(pendingKey(userId), secret, "EX", PENDING_TTL_SECONDS);
  }

  getPendingSecret(userId: string): Promise<string | null> {
    return this.redis.client.get(pendingKey(userId));
  }

  async clearPendingSecret(userId: string): Promise<void> {
    await this.redis.client.del(pendingKey(userId));
  }

  // ─── Active credential (Postgres, durable) ───────────────────────────────────────

  /** The one active (non-deleted) credential row for a user, if any. */
  private activeCredential(userId: string) {
    return this.prisma.client.twoFactorCredential.findFirst({
      where: { userId, deletedAt: null },
    });
  }

  async getActiveSecret(userId: string): Promise<string | null> {
    const row = await this.activeCredential(userId);
    // Stored encrypted (M4). decrypt() transparently passes through any legacy plaintext
    // row written before encryption-at-rest landed.
    return row ? decryptTwoFactorSecret(row.secret) : null;
  }

  /**
   * Activates the secret (post-verification) and issues a fresh set of backup codes
   * (returned in PLAINTEXT once). Any previously-active row is soft-deleted first so the
   * partial-unique index (user_id WHERE deleted_at IS NULL) never clashes on re-enrol.
   */
  async activate(tenantId: string, userId: string, secret: string): Promise<string[]> {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.twoFactorCredential.updateMany({
        where: { userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.twoFactorCredential.create({
        data: {
          tenantId,
          userId,
          // Encrypted at rest (M4) — never store the raw TOTP secret.
          secret: encryptTwoFactorSecret(secret),
          backupCodes: codes.map(hashBackupCode),
          activatedAt: new Date(),
        },
      });
    });
    await this.clearPendingSecret(userId);
    return codes;
  }

  /** Soft-deletes the active credential (disable flow). */
  async deactivate(userId: string): Promise<void> {
    await this.prisma.client.twoFactorCredential.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await this.clearPendingSecret(userId);
  }

  /** Verifies + CONSUMES (single-use) a backup code. Returns true if it matched an unused code. */
  async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const hash = hashBackupCode(code.trim().toUpperCase());
    // Read-modify-write inside a transaction so two concurrent uses of the same code
    // cannot both succeed (the second re-reads the shortened array and misses).
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.twoFactorCredential.findFirst({
        where: { userId, deletedAt: null },
        select: { id: true, backupCodes: true },
      });
      if (!row || !row.backupCodes.includes(hash)) return false;
      await tx.twoFactorCredential.update({
        where: { id: row.id },
        data: { backupCodes: row.backupCodes.filter((h) => h !== hash) },
      });
      return true;
    });
  }

  async countRemainingBackupCodes(userId: string): Promise<number> {
    const row = await this.activeCredential(userId);
    return row?.backupCodes.length ?? 0;
  }
}
