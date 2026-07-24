// apps/api/src/modules/auth/two-factor.service.ts
//
// Business logic for TOTP-based 2FA (T28, docs/plans/phase-9-completion.md). No Prisma
// here (CLAUDE.md §3.3) beyond delegating to AuthRepository for the single
// `users.two_fa_enabled` boolean column — secret/backup-code persistence goes through
// TwoFactorStore (durable Postgres `two_factor_credentials` for the active secret +
// backup codes; Redis only for the TTL'd enrollment-in-progress secret).

import { Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { AuthRepository } from "./auth.repository";
import { TwoFactorStore } from "./lib/two-factor-store";
import { generateTotpSecret, buildOtpauthUrl, verifyTotpCode } from "./lib/totp";
import type { TotpEnrollResponse, TotpStatusResponse, TotpVerifyEnrollResponse } from "./dto/two-factor.schemas";

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly store: TwoFactorStore,
  ) {}

  async status(userId: string): Promise<TotpStatusResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException({ code: "auth.unauthenticated", title: "User not found" });

    return {
      enabled: user.twoFaEnabled,
      remainingBackupCodes: user.twoFaEnabled ? await this.store.countRemainingBackupCodes(userId) : null,
    };
  }

  /** Starts (or restarts) enrollment — generates a new pending secret, TTL'd (see TwoFactorStore). */
  async enroll(userId: string): Promise<TotpEnrollResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException({ code: "auth.unauthenticated", title: "User not found" });

    const secret = generateTotpSecret();
    await this.store.setPendingSecret(userId, secret);
    return { secret, otpauthUrl: buildOtpauthUrl(secret, user.email) };
  }

  /** Confirms enrollment with a valid TOTP code, activates 2FA, and issues one-time backup codes. */
  async verifyEnroll(userId: string, code: string): Promise<TotpVerifyEnrollResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException({ code: "auth.unauthenticated", title: "User not found" });

    const pending = await this.store.getPendingSecret(userId);
    if (!pending) {
      throw new UnprocessableEntityException({
        code: "TOTP_ENROLLMENT_EXPIRED",
        title: "Enrollment expired or not started",
        detail: "Start enrollment again via POST /auth/2fa/enroll.",
      });
    }
    if (!verifyTotpCode(pending, code)) {
      throw new UnauthorizedException({ code: "TOTP_CODE_INVALID", title: "Invalid verification code" });
    }

    const backupCodes = await this.store.activate(user.tenantId, userId, pending);
    await this.authRepository.setTwoFaEnabled(userId, true);
    return { enabled: true, backupCodes };
  }

  /** Disables 2FA — requires a current valid TOTP or backup code (never a bare toggle). */
  async disable(userId: string, code: string): Promise<{ disabled: true }> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException({ code: "auth.unauthenticated", title: "User not found" });
    if (!user.twoFaEnabled) {
      throw new UnprocessableEntityException({ code: "TOTP_NOT_ENABLED", title: "Two-factor authentication is not enabled" });
    }

    const valid = await this.verifyCode(userId, code);
    if (!valid) {
      throw new UnauthorizedException({ code: "TOTP_CODE_INVALID", title: "Invalid verification code" });
    }

    await this.store.deactivate(userId);
    await this.authRepository.setTwoFaEnabled(userId, false);
    return { disabled: true };
  }

  /** Verifies a code against the ACTIVE secret (TOTP) OR consumes a single-use backup code. Used by both the disable flow and the 2FA login-verify step. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const secret = await this.store.getActiveSecret(userId);
      if (secret && verifyTotpCode(secret, trimmed)) return true;
    }
    // Fall through to backup-code check regardless of format (backup codes are
    // XXXXX-XXXXX, structurally distinct from a 6-digit TOTP code).
    return this.store.consumeBackupCode(userId, trimmed);
  }
}
