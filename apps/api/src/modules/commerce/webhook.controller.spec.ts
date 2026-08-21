// apps/api/src/modules/commerce/webhook.controller.spec.ts
//
// Unit tests for WebhookController's signature-freshness check (Phase-7 Wave 2 security
// hardening batch A, item 2a, extends P6 M-3 to Razorpay). Razorpay's webhook scheme
// has no dedicated timestamp header; the check reads `payload.created_at` from the
// (already-HMAC-covered) body when present, and is skipped (not rejected) when absent.

import { UnauthorizedException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { WebhookController } from "./webhook.controller";
import type { CommerceService } from "./commerce.service";
import type { PaymentProvider } from "./providers/payment/payment-provider.interface";
import { __resetEnvCacheForTests } from "../../config/env";

const REQUIRED_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
};

function makeRequest(body: Record<string, unknown>): RawBodyRequest<Request> {
  const raw = Buffer.from(JSON.stringify(body));
  return { rawBody: raw, body } as unknown as RawBodyRequest<Request>;
}

describe("WebhookController, signature freshness (Razorpay created_at)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let commerceService: jest.Mocked<CommerceService>;
  let paymentProvider: jest.Mocked<PaymentProvider>;
  let controller: WebhookController;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = { ...REQUIRED_ENV };
    __resetEnvCacheForTests();

    commerceService = {
      enqueueWebhookEvent: jest.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    paymentProvider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    controller = new WebhookController(commerceService, paymentProvider);
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetEnvCacheForTests();
  });

  it("processes a fresh payload (created_at within the default 300s window)", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ event: "payment.captured", created_at: nowSeconds - 10 });

    const result = await controller.handleWebhook(req, "valid-signature");

    expect(result).toEqual({ received: true });
    expect(commerceService.enqueueWebhookEvent).toHaveBeenCalled();
  });

  it("rejects a STALE payload (created_at older than the freshness window) even with a valid signature", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ event: "payment.captured", created_at: nowSeconds - 3600 }); // 1h old

    await expect(controller.handleWebhook(req, "valid-signature")).rejects.toThrow(UnauthorizedException);
    expect(commerceService.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it("skips the freshness check when created_at is absent (documented limitation, not a bypass of HMAC)", async () => {
    const req = makeRequest({ event: "payment.captured" });

    const result = await controller.handleWebhook(req, "valid-signature");

    expect(result).toEqual({ received: true });
    expect(commerceService.enqueueWebhookEvent).toHaveBeenCalled();
  });

  it("respects a configured WEBHOOK_SIGNATURE_MAX_AGE_SECONDS override", async () => {
    process.env = { ...REQUIRED_ENV, WEBHOOK_SIGNATURE_MAX_AGE_SECONDS: "5" };
    __resetEnvCacheForTests();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ event: "payment.captured", created_at: nowSeconds - 30 }); // 30s old, > 5s max

    await expect(controller.handleWebhook(req, "valid-signature")).rejects.toThrow(UnauthorizedException);
  });

  it("still rejects an invalid signature before ever reaching the freshness check", async () => {
    paymentProvider.verifyWebhookSignature.mockReturnValue(false);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ event: "payment.captured", created_at: nowSeconds });

    await expect(controller.handleWebhook(req, "bad-signature")).rejects.toThrow(UnauthorizedException);
    expect(commerceService.enqueueWebhookEvent).not.toHaveBeenCalled();
  });
});
