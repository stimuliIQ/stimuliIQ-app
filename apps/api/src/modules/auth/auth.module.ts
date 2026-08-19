// apps/api/src/modules/auth/auth.module.ts
//
// Wires the auth feature module (docs/04-trd-architecture.md §2.2 template). Exports
// `AuthRepository`, `TokenService`, `JwtAuthGuard`, `PermissionsGuard` so other modules
// (e.g. the audit-context middleware in common/) and future feature modules can reuse the
// same guards/services without re-declaring providers — DI tokens stay single-sourced.

import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { MeController } from "./me.controller";
import { AuthService } from "./auth.service";
import { AuthRepository } from "./auth.repository";
import { TokenService } from "./lib/token.service";
import { OtpStore } from "./lib/otp-store";
import { LoginRateLimiter } from "./lib/login-rate-limiter";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { AuthIpRateLimitGuard } from "./guards/auth-ip-rate-limit.guard";
import { ScopeInterceptor } from "./interceptors/scope.interceptor";
import { SmsProviderModule } from "./providers/sms/sms-provider.module";
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
// T28 (docs/plans/phase-9-completion.md): 2FA (TOTP, own-scope enrol/verify/disable +
// the unauthenticated login-verify second step) + password-reset (B9).
import { TwoFactorController, TwoFactorLoginController } from "./two-factor.controller";
import { TwoFactorService } from "./two-factor.service";
import { TwoFactorStore } from "./lib/two-factor-store";
import { PasswordResetController } from "./password-reset.controller";
import { PasswordResetService } from "./password-reset.service";
import { PasswordResetStore } from "./lib/password-reset-store";
// 2FA recovery: the "lost my authenticator" path — unauthenticated email-OTP reset.
// (The admin rescue path lives in AdminModule, which consumes TwoFactorStore via this
// module's exports.)
import { TwoFactorRecoveryController } from "./two-factor-recovery.controller";
import { TwoFactorRecoveryService } from "./two-factor-recovery.service";
import { TwoFactorRecoveryStore } from "./lib/two-factor-recovery-store";

@Module({
  imports: [
    // T16/B3: SMS_PROVIDER is now bound via SmsProviderModule's fail-closed
    // useFactory (noop|msg91, prod boot-throw) — mirrors MailProviderModule/
    // WhatsAppProviderModule. Previously bound directly via `useClass: Msg91SmsProvider`.
    SmsProviderModule,
    // T28: MAIL_PROVIDER — password-reset email + (indirectly) nothing else here; 2FA
    // itself sends no mail (TOTP is app-based, not email-based).
    MailProviderModule,
  ],
  controllers: [
    AuthController,
    MeController,
    TwoFactorController,
    TwoFactorLoginController,
    TwoFactorRecoveryController,
    PasswordResetController,
  ],
  providers: [
    AuthService,
    AuthRepository,
    TokenService,
    OtpStore,
    LoginRateLimiter,
    JwtAuthGuard,
    PermissionsGuard,
    AuthIpRateLimitGuard,
    ScopeInterceptor,
    TwoFactorService,
    TwoFactorStore,
    TwoFactorRecoveryService,
    TwoFactorRecoveryStore,
    PasswordResetService,
    PasswordResetStore,
  ],
  exports: [
    AuthRepository,
    TokenService,
    JwtAuthGuard,
    PermissionsGuard,
    AuthIpRateLimitGuard,
    OtpStore,
    // AdminModule's UsersAdminService injects this for the `twofa.reset` admin rescue
    // path (clearing a user's 2FA credential when they've lost device AND inbox).
    TwoFactorStore,
    // LmsAccountProvisioningService injects this for the CRM "Resend LMS credentials"
    // action, which mints a single-use reset link instead of emailing a password.
    PasswordResetStore,
    // Re-export the whole module (NOT just the SMS_PROVIDER token — Nest requires
    // re-exporting the providing module itself for a token that isn't declared in
    // THIS module's own `providers` array) so DispatchModule (and any future
    // consumer) can inject SMS_PROVIDER via `imports: [AuthModule]` without a
    // duplicate SmsProviderModule import — see dispatch.module.ts.
    SmsProviderModule,
  ],
})
export class AuthModule {}
