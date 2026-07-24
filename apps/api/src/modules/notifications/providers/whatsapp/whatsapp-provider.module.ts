// apps/api/src/modules/notifications/providers/whatsapp/whatsapp-provider.module.ts
//
// Binds WHATSAPP_PROVIDER → the adapter selected by the WHATSAPP_PROVIDER env
// variable, and exports it for consumption by NotificationsModule and CampaignsModule.
//
// Adapter selection logic:
//
//   WHATSAPP_PROVIDER=whatsapp_cloud
//   (+ WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN + WHATSAPP_APP_SECRET set)
//     → WhatsAppCloudProvider  (Meta WhatsApp Cloud API; direct fetch — no extra SDK)
//
//   WHATSAPP_PROVIDER=noop     (or unset)
//   AND NODE_ENV != production AND APP_ENV != production
//     → NoopWhatsAppProvider   (deterministic, no network — for dev + CI)
//
//   WHATSAPP_PROVIDER=whatsapp_cloud  (+ keys absent)
//   AND (NODE_ENV=production OR APP_ENV=production)
//     → THROWS at boot — application refuses to start (fail-closed, AC-13 equivalent).
//
//   WHATSAPP_PROVIDER=noop     (or unset)
//   AND (NODE_ENV=production OR APP_ENV=production)
//     → THROWS at boot — application refuses to start (fail-closed).
//       Prevents WHATSAPP_PROVIDER=noop from silently discarding messages in prod.
//
// DEFECT-1 / ADR-0023 compliance:
//   Bound via `useFactory` (not `useClass`) — mirrors CaptchaProviderModule,
//   VideoProviderModule, StorageProviderModule, MailProviderModule exactly.
//
// ─── FEATURE MODULE WIRING ───────────────────────────────────────────────────
//
//   // notifications.module.ts (or campaigns.module.ts)
//   import { WhatsAppProviderModule }
//     from '../notifications/providers/whatsapp/whatsapp-provider.module';
//
//   @Module({
//     imports: [WhatsAppProviderModule, ...],
//   })
//   export class NotificationsModule {}
//
// ─── TEST WIRING ─────────────────────────────────────────────────────────────
//
//   import { NoopWhatsAppProvider }
//     from '../notifications/providers/whatsapp/noop-whatsapp.provider';
//
//   const noop = new NoopWhatsAppProvider();
//   await Test.createTestingModule({
//     providers: [
//       NotificationsService,
//       { provide: WHATSAPP_PROVIDER, useValue: noop },
//     ],
//   }).compile();

import { Module, Logger } from "@nestjs/common";
import { validateEnv, isProductionEnv } from "../../../../config/env";
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from "./whatsapp-provider.interface";
import { NoopWhatsAppProvider } from "./noop-whatsapp.provider";
import { WhatsAppCloudProvider } from "./whatsapp-cloud.provider";

const bootLogger = new Logger("WhatsAppProviderModule");

/**
 * Constructs the WhatsAppProvider implementation selected by WHATSAPP_PROVIDER env var.
 *
 * Fail-closed in production: missing keys or WHATSAPP_PROVIDER=noop in production
 * causes a boot-time throw — the application will NOT start.
 *
 * NOTE: bound via `useFactory` (not `useClass`) to avoid the NestJS DI crash
 * (DEFECT-1). Mirrors the established provider module pattern.
 */
function createWhatsAppProvider(): WhatsAppProvider {
  const env = validateEnv();
  const selector = env.WHATSAPP_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);

  switch (selector) {
    case "whatsapp_cloud": {
      const hasPhoneId = Boolean(env.WHATSAPP_PHONE_NUMBER_ID);
      const hasToken = Boolean(env.WHATSAPP_ACCESS_TOKEN);
      const hasAppSecret = Boolean(env.WHATSAPP_APP_SECRET);

      if (!hasPhoneId || !hasToken || !hasAppSecret) {
        const missing = [
          ...(!hasPhoneId ? ["WHATSAPP_PHONE_NUMBER_ID"] : []),
          ...(!hasToken ? ["WHATSAPP_ACCESS_TOKEN"] : []),
          ...(!hasAppSecret ? ["WHATSAPP_APP_SECRET"] : []),
        ].join(", ");

        if (isProd) {
          throw new Error(
            `[WhatsAppProviderModule] WHATSAPP_PROVIDER=whatsapp_cloud but the following ` +
              `required environment variables are not set: ${missing}. ` +
              `The application will NOT start without them in production. ` +
              `Set these values and redeploy.`,
          );
        } else {
          bootLogger.warn(
            `[WhatsAppProviderModule] WHATSAPP_PROVIDER=whatsapp_cloud but ${missing} ` +
              `is not set (non-production). Falling back to NoopWhatsAppProvider. ` +
              `Set ${missing} before deploying to staging/prod.`,
          );
          return new NoopWhatsAppProvider();
        }
      }

      bootLogger.log(
        "[WhatsAppProviderModule] WHATSAPP_PROVIDER=whatsapp_cloud — " +
          `binding WhatsAppCloudProvider (phoneNumberId: ${env.WHATSAPP_PHONE_NUMBER_ID}).`,
      );
      return new WhatsAppCloudProvider();
    }

    case "noop": {
      if (isProd) {
        throw new Error(
          "[WhatsAppProviderModule] WHATSAPP_PROVIDER=noop in a production environment. " +
            "This would silently discard all outbound WhatsApp messages. " +
            "Set WHATSAPP_PROVIDER=whatsapp_cloud with WHATSAPP_PHONE_NUMBER_ID, " +
            "WHATSAPP_ACCESS_TOKEN, and WHATSAPP_APP_SECRET for production. " +
            "The application will NOT start with WHATSAPP_PROVIDER=noop in production.",
        );
      }
      bootLogger.warn(
        "[WhatsAppProviderModule] WHATSAPP_PROVIDER=noop — binding NoopWhatsAppProvider. " +
          "No WhatsApp messages will be sent. Set WHATSAPP_PROVIDER=whatsapp_cloud " +
          "with required keys for staging/prod.",
      );
      return new NoopWhatsAppProvider();
    }

    default: {
      if (isProd) {
        throw new Error(
          `[WhatsAppProviderModule] Unrecognised WHATSAPP_PROVIDER='${selector}' in production. ` +
            "Valid values: noop | whatsapp_cloud. The application will NOT start.",
        );
      }
      bootLogger.warn(
        `[WhatsAppProviderModule] Unrecognised WHATSAPP_PROVIDER='${selector}' — ` +
          "falling back to NoopWhatsAppProvider (non-production). " +
          "Valid values: noop | whatsapp_cloud.",
      );
      return new NoopWhatsAppProvider();
    }
  }
}

@Module({
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: createWhatsAppProvider,
    },
  ],
  // Export only the token — consumers inject WHATSAPP_PROVIDER, never the concrete class.
  exports: [WHATSAPP_PROVIDER],
})
export class WhatsAppProviderModule {}
