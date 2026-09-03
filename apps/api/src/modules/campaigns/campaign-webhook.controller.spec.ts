// apps/api/src/modules/campaigns/campaign-webhook.controller.spec.ts
//
// Unit tests for CampaignWebhookController's signature-freshness window (Phase-7 Wave 2
// security hardening batch A, item 2a, AC-59). The "email" channel (Resend/Svix) signs a
// timestamp as part of the HMAC-covered content, a validly-signed but STALE payload is
// rejected. The "whatsapp" channel (Meta) has no signed timestamp, freshness cannot be
// enforced there (documented limitation, not a bypass).

import { UnauthorizedException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { CampaignWebhookController } from "./campaign-webhook.controller";
import type { CampaignsService } from "./campaigns.service";
import type { MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import type { WhatsAppProvider } from "../notifications/providers/whatsapp/whatsapp-provider.interface";
import { __resetEnvCacheForTests } from "../../config/env";

const REQUIRED_ENV: NodeJS.ProcessEnv = {
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

function makeRequest(body: Record<string, unknown>): RawBodyRequest<Request> {
  return { rawBody: Buffer.from(JSON.stringify(body)) } as unknown as RawBodyRequest<Request>;
}

describe("CampaignWebhookController, signature freshness (AC-59)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let service: jest.Mocked<CampaignsService>;
  let mailProvider: jest.Mocked<MailProvider>;
  let whatsappProvider: jest.Mocked<WhatsAppProvider>;
  let controller: CampaignWebhookController;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = { ...REQUIRED_ENV };
    __resetEnvCacheForTests();

    service = {
      handleWebhookEvent: jest.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    mailProvider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    whatsappProvider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    controller = new CampaignWebhookController(service, mailProvider, whatsappProvider);
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetEnvCacheForTests();
  });

  it("email channel: processes a fresh payload (svix-timestamp within the default window)", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ providerMessageId: "msg-1", event: "delivered" });

    const result = await controller.handleWebhook("email", req, {
      "svix-id": "id-1",
      "svix-timestamp": String(nowSeconds - 10),
      "svix-signature": "v1,abc",
    });

    expect(result).toEqual({ received: true });
    expect(service.handleWebhookEvent).toHaveBeenCalled();
  });

  it("email channel: rejects a STALE svix-timestamp even with a valid signature", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ providerMessageId: "msg-1", event: "delivered" });

    await expect(
      controller.handleWebhook("email", req, {
        "svix-id": "id-1",
        "svix-timestamp": String(nowSeconds - 3600), // 1h old
        "svix-signature": "v1,abc",
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it("email channel: rejects a missing svix-timestamp even with a valid signature", async () => {
    const req = makeRequest({ providerMessageId: "msg-1", event: "delivered" });

    await expect(
      controller.handleWebhook("email", req, {
        "svix-id": "id-1",
        "svix-signature": "v1,abc",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("email channel: respects a configured WEBHOOK_SIGNATURE_MAX_AGE_SECONDS override", async () => {
    process.env = { ...REQUIRED_ENV, WEBHOOK_SIGNATURE_MAX_AGE_SECONDS: "5" };
    __resetEnvCacheForTests();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ providerMessageId: "msg-1", event: "delivered" });

    await expect(
      controller.handleWebhook("email", req, {
        "svix-id": "id-1",
        "svix-timestamp": String(nowSeconds - 30), // 30s old, > 5s max
        "svix-signature": "v1,abc",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("whatsapp channel: has no signed timestamp to check, processes normally when signature is valid", async () => {
    const req = makeRequest({ providerMessageId: "msg-2", event: "delivered" });

    const result = await controller.handleWebhook("whatsapp", req, {
      "x-hub-signature-256": "sha256=abc",
    });

    expect(result).toEqual({ received: true });
    expect(service.handleWebhookEvent).toHaveBeenCalled();
  });

  it("still rejects an invalid signature before ever reaching the freshness check", async () => {
    mailProvider.verifyWebhookSignature.mockReturnValue(false);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const req = makeRequest({ providerMessageId: "msg-1", event: "delivered" });

    await expect(
      controller.handleWebhook("email", req, {
        "svix-id": "id-1",
        "svix-timestamp": String(nowSeconds),
        "svix-signature": "v1,bad",
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.handleWebhookEvent).not.toHaveBeenCalled();
  });
});
