// apps/api/src/modules/notifications/providers/mail/mail-provider.module.ts
//
// Binds MAIL_PROVIDER → the adapter selected by the MAIL_PROVIDER env variable,
// and exports it for consumption by NotificationsModule and CampaignsModule.
//
// Adapter selection logic:
//
//   MAIL_PROVIDER=resend   (+ RESEND_API_KEY + MAIL_FROM set)
//     → ResendMailProvider  (real Resend SDK; production-ready)
//
//   MAIL_PROVIDER=noop     (or unset)
//   AND NODE_ENV != production AND APP_ENV != production
//     → NoopMailProvider    (deterministic, no network — for dev + CI)
//
//   MAIL_PROVIDER=resend   (+ RESEND_API_KEY or MAIL_FROM absent)
//   AND (NODE_ENV=production OR APP_ENV=production)
//     → THROWS at boot — application refuses to start (fail-closed, AC-13).
//       Prevents a misconfigured production deployment from silently not sending emails.
//
//   MAIL_PROVIDER=noop     (or unset OR missing keys)
//   AND (NODE_ENV=production OR APP_ENV=production)
//     → THROWS at boot — application refuses to start (fail-closed, AC-13).
//       Prevents MAIL_PROVIDER=noop from silently discarding all emails in production.
//
// DEFECT-1 / ADR-0023 compliance:
//   Bound via `useFactory` (not `useClass`) to bypass NestJS DI reflection on
//   classes with default-parameter constructors. Mirrors CaptchaProviderModule,
//   VideoProviderModule, and StorageProviderModule exactly.
//
// ─── FEATURE MODULE WIRING ───────────────────────────────────────────────────
//
//   // notifications.module.ts (or campaigns.module.ts)
//   import { MailProviderModule }
//     from '../notifications/providers/mail/mail-provider.module';
//
//   @Module({
//     imports: [MailProviderModule, ...],
//     providers: [NotificationsService, ...],
//   })
//   export class NotificationsModule {}
//
// ─── SERVICE USAGE ────────────────────────────────────────────────────────────
//
//   import { Inject } from '@nestjs/common';
//   import { MAIL_PROVIDER, MailProvider }
//     from '../notifications/providers/mail/mail-provider.interface';
//
//   @Injectable()
//   export class NotificationsService {
//     constructor(
//       @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
//     ) {}
//   }
//
// ─── TEST WIRING ─────────────────────────────────────────────────────────────
//
//   import { NoopMailProvider }
//     from '../notifications/providers/mail/noop-mail.provider';
//
//   const noop = new NoopMailProvider();
//   await Test.createTestingModule({
//     providers: [
//       NotificationsService,
//       { provide: MAIL_PROVIDER, useValue: noop },
//     ],
//   }).compile();

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv } from "../../../../config/env";
import { MAIL_PROVIDER, type MailProvider } from "./mail-provider.interface";
import { NoopMailProvider } from "./noop-mail.provider";
import { ResendMailProvider } from "./resend-mail.provider";

const bootLogger = new Logger("MailProviderModule");

/**
 * Constructs the MailProvider implementation selected by MAIL_PROVIDER env var.
 *
 * Fail-closed in production: missing keys or MAIL_PROVIDER=noop in production
 * causes a boot-time throw — the application will NOT start.
 *
 * NOTE: bound via `useFactory` (not `useClass`) to avoid the NestJS DI crash
 * (DEFECT-1): NoopMailProvider / ResendMailProvider constructors have no
 * required DI-injectable parameters, but optional-param constructors have an
 * emitted design-type of `Object` which confuses NestJS's reflection.
 * The factory `new`s the class directly, bypassing DI reflection.
 */
function createMailProvider(): MailProvider {
  const env = validateEnv();
  const selector = env.MAIL_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);

  switch (selector) {
    case "resend": {
      const hasApiKey = Boolean(env.RESEND_API_KEY);
      const hasFrom = Boolean(env.MAIL_FROM);

      if (!hasApiKey || !hasFrom) {
        if (isProd) {
          // Fail-closed in production (AC-13): throw to abort boot.
          const missing = [
            ...(!hasApiKey ? ["RESEND_API_KEY"] : []),
            ...(!hasFrom ? ["MAIL_FROM"] : []),
          ].join(", ");
          throw new Error(
            `[MailProviderModule] MAIL_PROVIDER=resend but the following required ` +
              `environment variables are not set: ${missing}. ` +
              `The application will NOT start without them in production. ` +
              `Set these values and redeploy.`,
          );
        } else {
          // In non-production, fall back to Noop with a loud warning.
          const missing = [
            ...(!hasApiKey ? ["RESEND_API_KEY"] : []),
            ...(!hasFrom ? ["MAIL_FROM"] : []),
          ].join(", ");
          bootLogger.warn(
            `[MailProviderModule] MAIL_PROVIDER=resend but ${missing} is not set ` +
              `(non-production). Falling back to NoopMailProvider. ` +
              `Set ${missing} before deploying to staging/prod.`,
          );
          return new NoopMailProvider();
        }
      }

      bootLogger.log(
        "[MailProviderModule] MAIL_PROVIDER=resend, binding ResendMailProvider " +
          `(from: ${env.MAIL_FROM}).`,
      );
      return new ResendMailProvider();
    }

    case "noop": {
      if (isProd) {
        // Fail-closed: MAIL_PROVIDER=noop in production is a boot-time error.
        throw new Error(
          "[MailProviderModule] MAIL_PROVIDER=noop in a production environment. " +
            "This would silently discard all outbound emails. " +
            "Set MAIL_PROVIDER=resend with RESEND_API_KEY and MAIL_FROM for production. " +
            "The application will NOT start with MAIL_PROVIDER=noop in production.",
        );
      }
      bootLogger.warn(
        "[MailProviderModule] MAIL_PROVIDER=noop, binding NoopMailProvider. " +
          "No emails will be sent. Set MAIL_PROVIDER=resend with RESEND_API_KEY " +
          "and MAIL_FROM for staging/prod.",
      );
      return new NoopMailProvider();
    }

    default: {
      if (isProd) {
        throw new Error(
          `[MailProviderModule] Unrecognised MAIL_PROVIDER='${selector}' in production. ` +
            "Valid values: noop | resend. The application will NOT start.",
        );
      }
      bootLogger.warn(
        `[MailProviderModule] Unrecognised MAIL_PROVIDER='${selector}' - ` +
          "falling back to NoopMailProvider (non-production). " +
          "Valid values: noop | resend.",
      );
      return new NoopMailProvider();
    }
  }
}

@Module({
  providers: [
    {
      provide: MAIL_PROVIDER,
      useFactory: createMailProvider,
    },
  ],
  // Export only the token — consumers inject MAIL_PROVIDER, never the concrete class.
  exports: [MAIL_PROVIDER],
})
export class MailProviderModule {}
