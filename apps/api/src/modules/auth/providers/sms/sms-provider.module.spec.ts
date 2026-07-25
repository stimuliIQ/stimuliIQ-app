// apps/api/src/modules/auth/providers/sms/sms-provider.module.spec.ts
//
// Tests the boot-time fail-closed guard in createSmsProvider (T16/B3, mirrors
// payment-provider.module.spec.ts / mail-provider.spec.ts's module-boot test strategy).
// The factory is not exported, so we drive it through the NestJS module exactly as
// boot does — compiling SmsProviderModule and resolving SMS_PROVIDER.

import { Test } from "@nestjs/testing";
import { SmsProviderModule } from "./sms-provider.module";
import { SMS_PROVIDER } from "./sms-provider.interface";
import { NoopSmsProvider } from "./noop-sms.provider";
import { Msg91SmsProvider } from "./msg91-sms.provider";
import { __resetEnvCacheForTests } from "../../../../config/env";

const BASE_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
};

const FULL_KEYS = {
  MSG91_AUTH_KEY: "test-auth-key",
  MSG91_SENDER: "STMLIQ",
  MSG91_TEMPLATE_ID: "1207162000000001234",
};

async function bootWith(env: Record<string, string | undefined>): Promise<unknown> {
  const previous = { ...process.env };
  for (const k of Object.keys(FULL_KEYS)) delete process.env[k];
  Object.assign(process.env, BASE_ENV, env);
  __resetEnvCacheForTests();
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [SmsProviderModule],
    }).compile();
    const provider = moduleRef.get(SMS_PROVIDER);
    await moduleRef.close();
    return provider;
  } finally {
    process.env = previous;
    __resetEnvCacheForTests();
  }
}

describe("SmsProviderModule fail-closed guard", () => {
  it("boots outside production with SMS_PROVIDER unset — binds NoopSmsProvider", async () => {
    const provider = await bootWith({ NODE_ENV: "development", APP_ENV: "local" });
    expect(provider).toBeInstanceOf(NoopSmsProvider);
  });

  it("boots outside production with SMS_PROVIDER=msg91 + all keys — binds Msg91SmsProvider", async () => {
    const provider = await bootWith({
      NODE_ENV: "development",
      APP_ENV: "local",
      SMS_PROVIDER: "msg91",
      ...FULL_KEYS,
    });
    expect(provider).toBeInstanceOf(Msg91SmsProvider);
  });

  it("boots outside production with SMS_PROVIDER=msg91 but missing keys — falls back to Noop", async () => {
    const provider = await bootWith({ NODE_ENV: "development", APP_ENV: "local", SMS_PROVIDER: "msg91" });
    expect(provider).toBeInstanceOf(NoopSmsProvider);
  });

  it("THROWS in production when SMS_PROVIDER=noop", async () => {
    await expect(bootWith({ NODE_ENV: "production", SMS_PROVIDER: "noop" })).rejects.toThrow(
      /silently discard every OTP/i,
    );
  });

  it("THROWS in production when SMS_PROVIDER is unset (defaults to noop)", async () => {
    await expect(bootWith({ NODE_ENV: "production" })).rejects.toThrow(/silently discard every OTP/i);
  });

  it("THROWS in production when SMS_PROVIDER=msg91 but keys are missing", async () => {
    await expect(bootWith({ NODE_ENV: "production", SMS_PROVIDER: "msg91" })).rejects.toThrow(
      /required environment variables are not set/i,
    );
  });

  it("boots in production when SMS_PROVIDER=msg91 with all keys present", async () => {
    const provider = await bootWith({ NODE_ENV: "production", SMS_PROVIDER: "msg91", ...FULL_KEYS });
    expect(provider).toBeInstanceOf(Msg91SmsProvider);
  });

  it("BOOTS in production when SMS_PROVIDER=disabled — binds NoopSmsProvider, no keys needed", async () => {
    const provider = await bootWith({ NODE_ENV: "production", SMS_PROVIDER: "disabled" });
    expect(provider).toBeInstanceOf(NoopSmsProvider);
  });
});
