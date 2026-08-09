// apps/api/src/modules/auth/two-factor-recovery.service.ts
//
// The "I lost my authenticator" path. Deliberately modelled on password-reset.service.ts
// (enumeration-resistant request -> mailed single-use credential -> confirm), with three
// differences that matter, all of them because THIS flow removes a security factor
// rather than rotating one:
//
//  1. THE PASSWORD IS RE-VERIFIED ON BOTH STEPS. Recovery must never be reachable with
//     inbox access alone — otherwise a compromised mailbox quietly downgrades every
//     enrolled account to single-factor. Password + emailed code keeps it at two
//     independent proofs.
//  2. NO SESSION IS ISSUED on success. The user is dropped back to a normal password
//     login and re-enrols. Minting a session here would make this endpoint a complete
//     2FA bypass in one call.
//  3. EVERY EXISTING SESSION IS REVOKED, and the reset is explicitly audit-logged
//     (the credential table is excluded from the automatic audit extension — see
//     AuthRepository.recordTwoFactorAudit).
//
// ENUMERATION RESISTANCE: request() ALWAYS returns the same generic message and HTTP 200
// — for a nonexistent email, a wrong password, an account without 2FA enrolled, a
// rate-limited caller, and a mail-provider outage alike. Only a fully-qualifying request
// actually sends anything.

import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import type {
  AppAudience,
  TwoFactorRecoveryConfirmResponse,
  TwoFactorRecoveryRequestResponse,
} from "@repo/types";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { TwoFactorStore } from "./lib/two-factor-store";
import { TwoFactorRecoveryStore } from "./lib/two-factor-recovery-store";
import { RedisService } from "../../redis/redis.service";
import { hitRedisWindow } from "../../common/rate-limit/redis-window-rate-limiter";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail } from "../notifications/dispatch/email-layout";

const GENERIC_MESSAGE =
  "If that account exists and has two-factor authentication enabled, a recovery code has been sent to its email address.";

// Tighter than password-reset's 3/60s: this flow strips a factor, so the cost of a
// generous limit is higher and the legitimate use ("I lost my phone") is rare.
const REQUEST_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const REQUEST_RATE_LIMIT_MAX_ATTEMPTS = 3;

@Injectable()
export class TwoFactorRecoveryService {
  private readonly logger = new Logger(TwoFactorRecoveryService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly authService: AuthService,
    private readonly twoFactorStore: TwoFactorStore,
    private readonly store: TwoFactorRecoveryStore,
    private readonly redis: RedisService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  async request(email: string, password: string, audience?: AppAudience): Promise<TwoFactorRecoveryRequestResponse> {
    // FAIL CLOSED (same rationale as PasswordResetService.request and
    // AuthIpRateLimitGuard): unauthenticated, factor-removing, no secondary control —
    // a Redis outage must not silently un-throttle it.
    const { limited } = await hitRedisWindow(
      this.redis.client,
      `auth:2fa-recovery:rl:${email.toLowerCase()}`,
      {
        windowSeconds: REQUEST_RATE_LIMIT_WINDOW_SECONDS,
        maxAttempts: REQUEST_RATE_LIMIT_MAX_ATTEMPTS,
        failClosed: true,
      },
      this.logger,
    );
    if (limited) {
      // Same generic 200 — a distinguishable rate-limit response would itself be an
      // enumeration oracle ("this address gets a lot of recovery traffic").
      this.logger.warn("[TwoFactorRecovery] request rate-limited — skipping send.");
      return { message: GENERIC_MESSAGE };
    }

    // Re-verifies the password with the SAME enumeration-resistant argon2 comparison
    // login() uses (dummy-hash fallback on a missing user), and returns null for a
    // wrong password, an inactive account, or no such user — all indistinguishable here.
    const check = await this.authService.verifyCredentialsOnly(email, password);
    if (check?.twoFaEnabled) {
      const user = await this.authRepository.findUserById(check.id);
      if (user) {
        const { code, expiresInMinutes } = await this.store.issue(user.id);
        try {
          await this.mail.send({
            to: user.email,
            subject: "Your Stimuli IQ two-factor recovery code",
            html: renderBrandedEmail({
              title: "Two-factor recovery code",
              paragraphs: [
                `Enter this code to turn off two-factor authentication on your account: <strong>${code}</strong>`,
                `The code expires in ${expiresInMinutes} minutes and can only be used once.`,
                // Naming the surface is real security signal, not decoration: a staff
                // member who never opens the admin dashboard should be alarmed by a
                // request that says it came from there.
                `This was requested from the ${audience === "crm" ? "admin dashboard" : "student portal"} sign-in page.`,
                "Once two-factor authentication is off, sign in with your password and enrol a new authenticator app straight away.",
              ],
              footnote:
                "If you did not request this, ignore this email — your two-factor authentication stays on. Someone knowing your password is enough to trigger this email, so if you were not expecting it, change your password now.",
            }),
            tags: [{ name: "category", value: "two_factor_recovery" }],
          });
        } catch (err) {
          // Never surfaced — leaking a provider error here would break enumeration
          // resistance (only real addresses can produce a send failure).
          this.logger.error(
            `[TwoFactorRecovery] mail send failed userId=${user.id}: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
      }
    }

    return { message: GENERIC_MESSAGE };
  }

  async confirm(
    email: string,
    password: string,
    code: string,
    meta?: { ip?: string },
  ): Promise<TwoFactorRecoveryConfirmResponse> {
    const invalid = new UnprocessableEntityException({
      code: "RECOVERY_CODE_INVALID",
      title: "That recovery code is invalid or has expired",
      detail: "Request a new recovery code and try again.",
    });

    // Password is re-checked here, not just at request time — otherwise anyone who
    // intercepted the emailed code could complete the reset without it.
    const check = await this.authService.verifyCredentialsOnly(email, password);
    // Identical error for bad credentials, no 2FA, and a bad code: this endpoint must
    // not become an oracle for any of the three.
    if (!check?.twoFaEnabled) throw invalid;

    const valid = await this.store.verify(check.id, code);
    if (!valid) throw invalid;

    const user = await this.authRepository.findUserById(check.id);
    if (!user) throw invalid;

    // Order matters: drop the credential first, then the flag, so a failure part-way
    // through can never leave `twoFaEnabled: false` with a live credential still
    // attached (which would leave the user unable to log in by either route).
    await this.twoFactorStore.deactivate(user.id);
    await this.authRepository.setTwoFaEnabled(user.id, false);
    // A factor just disappeared — any session minted before it did must not outlive it.
    await this.authRepository.revokeAllSessionsForUser(user.id);
    await this.authRepository.recordTwoFactorAudit({
      tenantId: user.tenantId,
      actorId: null, // self-service: no session exists, and the subject is the actor.
      userId: user.id,
      action: "two_factor.recovery_reset",
      ip: meta?.ip,
    });

    return { reset: true };
  }
}
