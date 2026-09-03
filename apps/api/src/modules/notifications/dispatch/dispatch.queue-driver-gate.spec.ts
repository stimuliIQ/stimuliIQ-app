// apps/api/src/modules/notifications/dispatch/dispatch.queue-driver-gate.spec.ts
//
// Verifies DispatchModule's QUEUE_DRIVER gate for NOTIFICATION_DISPATCH_PORT and
// CAMPAIGN_SEND_PORT (docs/plans/phase-9-completion.md T18/R1). `bullmq` is mocked,
// no real Redis connection is opened.

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({ name, add: jest.fn() })),
}));

import { Test } from "@nestjs/testing";
import { DispatchModule } from "./dispatch.module";
import { NOTIFICATION_DISPATCH_PORT } from "./notification-dispatch.port";
import { CAMPAIGN_SEND_PORT } from "./campaign-send.port";
import { SyncNotificationDispatchAdapter } from "./sync-notification-dispatch.adapter";
import { SyncCampaignSendAdapter } from "./sync-campaign-send.adapter";
import { BullMqNotificationDispatchAdapter } from "./bullmq-notification-dispatch.adapter";
import { BullMqCampaignSendAdapter } from "./bullmq-campaign-send.adapter";
import { __resetEnvCacheForTests } from "../../../config/env";

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

async function bootWith(env: Record<string, string | undefined>): Promise<{
  dispatchPort: unknown;
  campaignPort: unknown;
}> {
  const previous = { ...process.env };
  Object.assign(process.env, BASE_ENV, env);
  __resetEnvCacheForTests();
  try {
    const moduleRef = await Test.createTestingModule({ imports: [DispatchModule] }).compile();
    const dispatchPort = moduleRef.get(NOTIFICATION_DISPATCH_PORT);
    const campaignPort = moduleRef.get(CAMPAIGN_SEND_PORT);
    await moduleRef.close();
    return { dispatchPort, campaignPort };
  } finally {
    process.env = previous;
    __resetEnvCacheForTests();
  }
}

describe("DispatchModule QUEUE_DRIVER gate", () => {
  it("QUEUE_DRIVER=sync (default) binds the Sync* adapters", async () => {
    const { dispatchPort, campaignPort } = await bootWith({ NODE_ENV: "development" });
    expect(dispatchPort).toBeInstanceOf(SyncNotificationDispatchAdapter);
    expect(campaignPort).toBeInstanceOf(SyncCampaignSendAdapter);
  });

  it("QUEUE_DRIVER=bullmq binds the BullMq* adapters", async () => {
    const { dispatchPort, campaignPort } = await bootWith({ NODE_ENV: "development", QUEUE_DRIVER: "bullmq" });
    expect(dispatchPort).toBeInstanceOf(BullMqNotificationDispatchAdapter);
    expect(campaignPort).toBeInstanceOf(BullMqCampaignSendAdapter);
  });
});
