// apps/api/src/modules/auth/providers/sms/sms-provider.module.ts
//
// Binds SMS_PROVIDER → the adapter selected by the SMS_PROVIDER env variable, and
// exports it for consumption by AuthModule and DispatchModule
// (docs/plans/phase-9-completion.md T16 / B3).
//
// Adapter selection logic (mirrors MailProviderModule/WhatsAppProviderModule exactly):
//
//   SMS_PROVIDER=msg91   (+ MSG91_AUTH_KEY + MSG91_SENDER + MSG91_TEMPLATE_ID set)
//     → Msg91SmsProvider   (real MSG91 HTTP calls; production-ready)
//
//   SMS_PROVIDER=noop    (or unset)
//   AND NODE_ENV != production AND APP_ENV != production
//     → NoopSmsProvider    (deterministic, no network, OTP never logged — dev + CI)
//
//   SMS_PROVIDER=msg91   (+ any of the three keys absent)
//   AND (NODE_ENV=production OR APP_ENV=production)
//     → THROWS at boot — application refuses to start (fail-closed).
//
//   SMS_PROVIDER=noop    (or unset OR missing keys)
//   AND (NODE_ENV=production OR APP_ENV=production)
//     → THROWS at boot — application refuses to start (fail-closed). Prevents
//       SMS_PROVIDER=noop from silently discarding every OTP/transactional SMS
//       (including login OTP — a hard product outage, not a degraded feature) in prod.
//
// Bound via `useFactory` (ADR-0023/DEFECT-1), identical rationale to
// MailProviderModule/VideoProviderModule/StorageProviderModule/PaymentProviderModule:
// NoopSmsProvider/Msg91SmsProvider constructors have no required DI-injectable
// parameters, but their emitted design-type confuses NestJS's `useClass` reflection.
// The factory `new`s the class directly, bypassing DI reflection.
//
// ─── FEATURE MODULE WIRING ────────────────────────────────────────────────────
//
//   // auth.module.ts / dispatch.module.ts
//   import { SmsProviderModule } from './providers/sms/sms-provider.module';
//
//   @Module({
//     imports: [SmsProviderModule, ...],
//     providers: [AuthService, ...],
//   })
//   export class AuthModule {}
//
// ─── SERVICE USAGE ────────────────────────────────────────────────────────────
//
//   import { Inject } from '@nestjs/common';
//   import { SMS_PROVIDER, SmsProvider } from './providers/sms/sms-provider.interface';
//
//   @Injectable()
//   export class AuthService {
//     constructor(@Inject(SMS_PROVIDER) private readonly sms: SmsProvider) {}
//   }
//
// ─── TEST WIRING ─────────────────────────────────────────────────────────────
//
//   import { NoopSmsProvider } from './providers/sms/noop-sms.provider';
//
//   const noop = new NoopSmsProvider();
//   await Test.createTestingModule({
//     providers: [AuthService, { provide: SMS_PROVIDER, useValue: noop }],
//   }).compile();

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv } from "../../../../config/env";
import { SMS_PROVIDER, type SmsProvider } from "./sms-provider.interface";
import { NoopSmsProvider } from "./noop-sms.provider";
import { Msg91SmsProvider } from "./msg91-sms.provider";

const bootLogger = new Logger("SmsProviderModule");

/**
 * Constructs the SmsProvider implementation selected by the SMS_PROVIDER env var.
 *
 * Fail-closed in production: SMS_PROVIDER=noop OR missing MSG91 keys in production
 * causes a boot-time throw — the application will NOT start.
 */
function createSmsProvider(): SmsProvider {
  const env = validateEnv();
  const selector = env.SMS_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);

  switch (selector) {
    case "msg91": {
      const missing = [
        ...(!env.MSG91_AUTH_KEY ? ["MSG91_AUTH_KEY"] : []),
        ...(!env.MSG91_SENDER ? ["MSG91_SENDER"] : []),
        ...(!env.MSG91_TEMPLATE_ID ? ["MSG91_TEMPLATE_ID"] : []),
      ];

      if (missing.length > 0) {
        if (isProd) {
          throw new Error(
            `[SmsProviderModule] SMS_PROVIDER=msg91 but the following required environment ` +
              `variables are not set: ${missing.join(", ")}. Login OTP and all transactional ` +
              `SMS would fail. The application will NOT start without them in production.`,
          );
        }
        bootLogger.warn(
          `[SmsProviderModule] SMS_PROVIDER=msg91 but ${missing.join(", ")} is not set ` +
            `(non-production). Falling back to NoopSmsProvider. Set these before deploying ` +
            `to staging/prod.`,
        );
        return new NoopSmsProvider();
      }

      bootLogger.log(`[SmsProviderModule] SMS_PROVIDER=msg91 — binding Msg91SmsProvider (sender: ${env.MSG91_SENDER}).`);
      return new Msg91SmsProvider();
    }

    case "noop": {
      if (isProd) {
        throw new Error(
          "[SmsProviderModule] SMS_PROVIDER=noop in a production environment. This would " +
            "silently discard every OTP and transactional SMS — including login OTP, a hard " +
            "outage. Set SMS_PROVIDER=msg91 with MSG91_AUTH_KEY/MSG91_SENDER/MSG91_TEMPLATE_ID " +
            "for production. The application will NOT start with SMS_PROVIDER=noop in production.",
        );
      }
      bootLogger.warn(
        "[SmsProviderModule] SMS_PROVIDER=noop — binding NoopSmsProvider. No SMS will be sent " +
          "and OTP codes are never logged. Set SMS_PROVIDER=msg91 for staging/prod.",
      );
      return new NoopSmsProvider();
    }

    default: {
      if (isProd) {
        throw new Error(
          `[SmsProviderModule] Unrecognised SMS_PROVIDER='${selector}' in production. ` +
            "Valid values: noop | msg91. The application will NOT start.",
        );
      }
      bootLogger.warn(
        `[SmsProviderModule] Unrecognised SMS_PROVIDER='${selector}' — falling back to ` +
          "NoopSmsProvider (non-production). Valid values: noop | msg91.",
      );
      return new NoopSmsProvider();
    }
  }
}

@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      useFactory: createSmsProvider,
    },
  ],
  // Export only the token — consumers inject SMS_PROVIDER, never the concrete class.
  exports: [SMS_PROVIDER],
})
export class SmsProviderModule {}
