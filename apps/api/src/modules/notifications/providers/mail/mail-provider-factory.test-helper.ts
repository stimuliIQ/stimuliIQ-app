// apps/api/src/modules/notifications/providers/mail/mail-provider-factory.test-helper.ts
//
// TEST-ONLY helper that exposes the createMailProvider factory function for
// unit-testing the fail-closed logic in MailProviderModule without spinning up
// the full NestJS DI container.
//
// This file is NEVER imported by production code. Jest imports it dynamically
// in mail-provider.spec.ts (Suite 3) to assert boot-time throws.

import { validateEnv } from "../../../../config/env";
import { type MailProvider } from "./mail-provider.interface";
import { NoopMailProvider } from "./noop-mail.provider";
import { ResendMailProvider } from "./resend-mail.provider";
import { Logger } from "@nestjs/common";

const testLogger = new Logger("MailProviderFactoryTestHelper");

function isProductionEnv(env: ReturnType<typeof validateEnv>): boolean {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

/**
 * Exposes the same factory logic as MailProviderModule for unit testing.
 * Throws when called under production conditions with missing keys — mirrors
 * the exact production fail-closed behavior.
 */
export function createMailProviderForTest(): MailProvider {
  const env = validateEnv();
  const selector = env.MAIL_PROVIDER ?? "noop";
  const isProd = isProductionEnv(env);

  switch (selector) {
    case "resend": {
      const hasApiKey = Boolean(env.RESEND_API_KEY);
      const hasFrom = Boolean(env.MAIL_FROM);
      if (!hasApiKey || !hasFrom) {
        const missing = [
          ...(!hasApiKey ? ["RESEND_API_KEY"] : []),
          ...(!hasFrom ? ["MAIL_FROM"] : []),
        ].join(", ");
        if (isProd) {
          throw new Error(
            `[MailProviderModule] MAIL_PROVIDER=resend but the following required ` +
              `environment variables are not set: ${missing}. ` +
              `The application will NOT start without them in production.`,
          );
        }
        testLogger.warn(`[TEST] Missing ${missing}, falling back to NoopMailProvider`);
        return new NoopMailProvider();
      }
      return new ResendMailProvider();
    }
    case "noop": {
      if (isProd) {
        throw new Error(
          "[MailProviderModule] MAIL_PROVIDER=noop in a production environment. " +
            "The application will NOT start with MAIL_PROVIDER=noop in production.",
        );
      }
      return new NoopMailProvider();
    }
    default: {
      if (isProd) {
        throw new Error(
          `[MailProviderModule] Unrecognised MAIL_PROVIDER='${selector}' in production.`,
        );
      }
      return new NoopMailProvider();
    }
  }
}
