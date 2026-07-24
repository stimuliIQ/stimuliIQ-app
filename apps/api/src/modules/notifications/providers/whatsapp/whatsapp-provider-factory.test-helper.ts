// apps/api/src/modules/notifications/providers/whatsapp/whatsapp-provider-factory.test-helper.ts
//
// TEST-ONLY helper that exposes the createWhatsAppProvider factory function for
// unit-testing the fail-closed logic in WhatsAppProviderModule without spinning up
// the full NestJS DI container.

import { validateEnv } from "../../../../config/env";
import { type WhatsAppProvider } from "./whatsapp-provider.interface";
import { NoopWhatsAppProvider } from "./noop-whatsapp.provider";
import { WhatsAppCloudProvider } from "./whatsapp-cloud.provider";
import { Logger } from "@nestjs/common";

const testLogger = new Logger("WhatsAppProviderFactoryTestHelper");

function isProductionEnv(env: ReturnType<typeof validateEnv>): boolean {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

export function createWhatsAppProviderForTest(): WhatsAppProvider {
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
              `The application will NOT start without them in production.`,
          );
        }
        testLogger.warn(`[TEST] Missing ${missing} — falling back to NoopWhatsAppProvider`);
        return new NoopWhatsAppProvider();
      }
      return new WhatsAppCloudProvider();
    }
    case "noop": {
      if (isProd) {
        throw new Error(
          "[WhatsAppProviderModule] WHATSAPP_PROVIDER=noop in a production environment. " +
            "The application will NOT start with WHATSAPP_PROVIDER=noop in production.",
        );
      }
      return new NoopWhatsAppProvider();
    }
    default: {
      if (isProd) {
        throw new Error(
          `[WhatsAppProviderModule] Unrecognised WHATSAPP_PROVIDER='${selector}' in production.`,
        );
      }
      return new NoopWhatsAppProvider();
    }
  }
}
