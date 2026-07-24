// apps/api/src/modules/auth/password-reset.service.ts
//
// Business logic for the password-reset flow (T28 / B9, docs/plans/
// phase-9-completion.md). Two-step: request (enumeration-resistant, ALWAYS 200) ->
// tokenized email via MailProvider -> confirm (single-use, expiring token).
//
// ENUMERATION RESISTANCE (AC per packages/types/src/auth/password-reset.schemas.ts file
// header): request() ALWAYS returns the same generic message + HTTP 200 regardless of
// whether the email matches a real account — the email is only actually sent if a
// matching ACTIVE user with a set password exists. No timing side-channel mitigation is
// applied here (unlike login()'s dummy-argon2-verify) because there is no password
// comparison in this path at all — the operation is "does this row exist + does mail
// send", not "is this password correct".

import { BadRequestException, Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import * as argon2 from "argon2";
import type { AppAudience, ConfirmPasswordResetResponse, RequestPasswordResetResponse } from "@repo/types";
import { AuthRepository } from "./auth.repository";
import { PasswordResetStore } from "./lib/password-reset-store";
import { ARGON2_HASH_OPTIONS } from "./lib/argon2-params";
import { RedisService } from "../../redis/redis.service";
import { hitRedisWindow } from "../../common/rate-limit/redis-window-rate-limiter";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { validateEnv } from "../../config/env";

const TENANT_SLUG = "stimuliiq"; // Phase 0: single tenant (matches auth.service.ts precedent).
const GENERIC_MESSAGE = "If an account exists for that email, a password reset link has been sent.";
const REQUEST_RATE_LIMIT_WINDOW_SECONDS = 60;
const REQUEST_RATE_LIMIT_MAX_ATTEMPTS = 3;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly store: PasswordResetStore,
    private readonly redis: RedisService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  async request(email: string, audience?: AppAudience): Promise<RequestPasswordResetResponse> {
    // FAIL CLOSED (mirrors AuthIpRateLimitGuard's documented rationale — this is an
    // unauthenticated write-adjacent surface with no secondary control): a Redis error
    // is treated as rate-limited.
    const { limited } = await hitRedisWindow(
      this.redis.client,
      `auth:password-reset:rl:${email.toLowerCase()}`,
      { windowSeconds: REQUEST_RATE_LIMIT_WINDOW_SECONDS, maxAttempts: REQUEST_RATE_LIMIT_MAX_ATTEMPTS, failClosed: true },
      this.logger,
    );
    if (limited) {
      // Still returns the SAME generic 200 — rate-limiting must not become an
      // enumeration oracle either (a distinguishable rate-limit response would leak
      // "this email has been requested a lot", which is itself a signal). Silently
      // skip sending; the caller sees no difference from the normal path.
      this.logger.warn(`[PasswordReset] request rate-limited for a hashed email bucket — skipping send.`);
      return { message: GENERIC_MESSAGE };
    }

    const user = await this.authRepository.findUserByEmail(TENANT_SLUG, email);
    if (user && user.passwordHash && user.status === "active") {
      const token = await this.store.issue(user.id);
      const env = validateEnv();
      // Staff reset from the CRM lands on the CRM's own /reset-password route; the LMS
      // (and any caller that omits audience) keeps the original LMS destination.
      const appBaseUrl = audience === "crm" ? env.CRM_APP_URL : env.LMS_APP_URL;
      const resetUrl = `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      try {
        await this.mail.send({
          to: user.email,
          subject: "Reset your stimuliIQ password",
          html: `<p>Click the link below to reset your password. This link expires in 30 minutes and can only be used once.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, you can safely ignore this email.</p>`,
          tags: [{ name: "category", value: "password_reset" }],
        });
      } catch (err) {
        // Never surface a mail-provider failure to the caller (would break enumeration
        // resistance AND leak provider errors) — logged only.
        this.logger.error(`[PasswordReset] mail send failed userId=${user.id}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    return { message: GENERIC_MESSAGE };
  }

  async confirm(token: string, newPassword: string): Promise<ConfirmPasswordResetResponse> {
    const userId = await this.store.consume(token);
    if (!userId) {
      throw new UnprocessableEntityException({
        code: "TOKEN_INVALID_OR_EXPIRED",
        title: "Reset link is invalid or has expired",
        detail: "Request a new password reset link.",
      });
    }

    const user = await this.authRepository.findUserById(userId);
    if (!user || user.status !== "active") {
      // The token was valid (issued for a real, then-active user) but the account is no
      // longer usable — same generic error, never reveal WHY.
      throw new UnprocessableEntityException({ code: "TOKEN_INVALID_OR_EXPIRED", title: "Reset link is invalid or has expired" });
    }

    if (newPassword.length < 1) {
      throw new BadRequestException({ code: "validation.failed", title: "Password is required" });
    }

    const passwordHash = await argon2.hash(newPassword, ARGON2_HASH_OPTIONS);
    await this.authRepository.updatePasswordHash(userId, passwordHash);
    // Security best practice: invalidate every existing session so a stolen/leaked
    // session cannot outlive the credential change.
    await this.authRepository.revokeAllSessionsForUser(userId);

    return { reset: true };
  }
}
