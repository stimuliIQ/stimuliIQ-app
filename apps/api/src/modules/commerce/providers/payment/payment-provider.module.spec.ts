// apps/api/src/modules/commerce/providers/payment/payment-provider.module.spec.ts
//
// Tests the boot-time fail-closed guard in createPaymentProvider (B2, go-live
// checklist). The factory is not exported, so we drive it through the NestJS module
// exactly as boot does, compiling PaymentProviderModule and resolving PAYMENT_PROVIDER.
//
// Two production failure modes must abort boot rather than degrade silently:
//   1. Missing Razorpay keys (checkout 500s; webhook fails closed → no enrollment ever).
//   2. A rzp_test_* key in production (accepts fake payments, enrolls non-payers).
// And the inverse: a rzp_live_* key OUTSIDE production must also throw (real money in dev).

import { Test } from "@nestjs/testing";
import { PaymentProviderModule } from "./payment-provider.module";
import { PAYMENT_PROVIDER } from "./payment-provider.interface";
import { __resetEnvCacheForTests } from "../../../../config/env";

const BASE_ENV = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" (a session cookie without Secure, or scoped to localhost, is a real
  // misconfiguration) — and every case below that exercises a production boot guard
  // sets exactly that. Without them the spec would fail on env validation before ever
  // reaching the guard it is testing.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

const FULL_KEYS = {
  RAZORPAY_KEY_ID: "rzp_test_TESTKEYID00001",
  RAZORPAY_KEY_SECRET: "test-secret-key",
  RAZORPAY_WEBHOOK_SECRET: "test-wh-secret",
};

async function bootWith(env: Record<string, string | undefined>): Promise<void> {
  const previous = { ...process.env };
  // Start from a clean slate so a stray real key in the shell env can't leak in.
  for (const k of Object.keys(FULL_KEYS)) delete process.env[k];
  Object.assign(process.env, BASE_ENV, env);
  __resetEnvCacheForTests();
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentProviderModule],
    }).compile();
    // Force the useFactory to run.
    moduleRef.get(PAYMENT_PROVIDER);
    await moduleRef.close();
  } finally {
    process.env = previous;
    __resetEnvCacheForTests();
  }
}

describe("PaymentProviderModule fail-closed guard", () => {
  it("boots outside production with a test key + all secrets", async () => {
    await expect(
      bootWith({ NODE_ENV: "development", APP_ENV: "local", ...FULL_KEYS }),
    ).resolves.not.toThrow();
  });

  it("boots outside production even with no keys (warn + lazy validation)", async () => {
    await expect(bootWith({ NODE_ENV: "development", APP_ENV: "local" })).resolves.not.toThrow();
  });

  it("THROWS in production when Razorpay keys are missing", async () => {
    await expect(bootWith({ NODE_ENV: "production" })).rejects.toThrow(
      /required Razorpay environment variables are not set/i,
    );
  });

  it("THROWS in production when the key is a TEST key (rzp_test_*)", async () => {
    await expect(
      bootWith({ NODE_ENV: "production", ...FULL_KEYS /* rzp_test_ */ }),
    ).rejects.toThrow(/TEST key .* in a production environment/i);
  });

  it("boots in production with a LIVE key + all secrets", async () => {
    await expect(
      bootWith({
        NODE_ENV: "production",
        ...FULL_KEYS,
        RAZORPAY_KEY_ID: "rzp_live_LIVEKEYID00001",
      }),
    ).resolves.not.toThrow();
  });

  it("THROWS outside production when a LIVE key is configured (real money in dev)", async () => {
    await expect(
      bootWith({
        NODE_ENV: "development",
        APP_ENV: "local",
        ...FULL_KEYS,
        RAZORPAY_KEY_ID: "rzp_live_LIVEKEYID00001",
      }),
    ).rejects.toThrow(/LIVE key .* outside a production environment/i);
  });

  it("BOOTS in production when PAYMENT_PROVIDER=disabled, no Razorpay keys needed", async () => {
    await expect(
      bootWith({ NODE_ENV: "production", PAYMENT_PROVIDER: "disabled" }),
    ).resolves.not.toThrow();
  });

  it("BOOTS in production when PAYMENT_PROVIDER=disabled even with a rzp_test_ key present", async () => {
    // disabled short-circuits before the test/live-key-prefix guard runs.
    await expect(
      bootWith({ NODE_ENV: "production", PAYMENT_PROVIDER: "disabled", ...FULL_KEYS }),
    ).resolves.not.toThrow();
  });
});
