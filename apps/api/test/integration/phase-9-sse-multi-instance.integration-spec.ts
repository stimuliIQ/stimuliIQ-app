// apps/api/test/integration/phase-9-sse-multi-instance.integration-spec.ts
//
// Phase-9 Completion T31 / R10: proves the SSE notification stream survives across TWO
// separate API "instances" sharing the same Redis — a notification published via
// `NotificationsService.notify()` on instance A's in-process fan-out MUST reach an SSE
// subscriber registered on instance B's in-process fan-out (the exact scenario a
// multi-replica deployment behind a load balancer produces: the HTTP request that
// triggers a notification lands on a different replica than the student's open SSE
// connection).
//
// PATTERN: matches p6-engagement.integration-spec.ts (STATE_FILE env bootstrap, real
// Postgres + Redis via testcontainers/ambient docker-compose, `describeIfAvailable`).
// Two full `AppModule` instances are booted (each gets its OWN `NotificationsService`
// singleton, its OWN in-process `sseSubscribers` map, and its OWN dedicated Redis
// pub/sub subscriber connection) — this is the closest a single Jest process can get to
// simulating two real replicas without spinning up a second OS process.

import { readFileSync } from "node:fs";
import { STATE_FILE, type IntegrationEnvFile } from "./global-setup";

const envFile: IntegrationEnvFile = JSON.parse(readFileSync(STATE_FILE, "utf8"));

if (envFile.available) {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = envFile.databaseUrl;
  process.env.REDIS_URL = envFile.redisUrl;
  process.env.JWT_PRIVATE_KEY_PATH = require.resolve("../../../../keys/jwt-private.pem");
  process.env.JWT_PUBLIC_KEY_PATH = require.resolve("../../../../keys/jwt-public.pem");
  process.env.JWT_ACCESS_TTL = "15m";
  process.env.JWT_REFRESH_TTL = "7d";
  process.env.JWT_AUDIENCE = "stimuliiq-clients";
  process.env.COOKIE_SECRET = "integration-test-cookie-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.CSRF_SECRET = "integration-test-csrf-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";
  process.env.COOKIE_SECURE = "false";
  process.env.WEB_APP_URL = "http://localhost:3000";
  process.env.LMS_APP_URL = "http://localhost:3001";
  process.env.CRM_APP_URL = "http://localhost:3002";
  process.env.VIDEO_PROVIDER = "noop";
  process.env.STORAGE_PROVIDER = "noop";
  process.env.MAIL_PROVIDER = "noop";
  process.env.WHATSAPP_PROVIDER = "noop";
  process.env.CAPTCHA_PROVIDER = "noop";
  process.env.NOTIFICATION_SIGNING_SECRET = "integration-test-notification-signing-secret-xxxxxxxx";
  process.env.MAIL_WEBHOOK_SECRET = "integration-test-mail-webhook-secret-yyyyyyyy";
  process.env.WHATSAPP_APP_SECRET = "integration-test-whatsapp-app-secret-zzzzzzzz";
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

function timeoutAfter<T>(ms: number, label: string): Promise<T> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
}

describeIfAvailable("Phase-9 T31/R10 — SSE multi-instance fan-out via Redis pub/sub", () => {
  const { Test } = require("@nestjs/testing");
  const { PrismaClient } = require("@prisma/client");
  const { AppModule } = require("../../src/app.module");
  const { NotificationsService } = require("../../src/modules/notifications/notifications.service");

  let appA: import("@nestjs/common").INestApplication;
  let appB: import("@nestjs/common").INestApplication;
  let prisma: InstanceType<typeof PrismaClient>;

  let notifSvcA: InstanceType<typeof NotificationsService>;
  let notifSvcB: InstanceType<typeof NotificationsService>;

  let tenantId: string;
  let studentUserId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: envFile.databaseUrl });
    await prisma.$connect();

    const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
    if (!tenant) throw new Error("No tenant found — run `pnpm db:seed` first.");
    tenantId = tenant.id;

    const student = await prisma.user.findFirst({
      where: { tenantId, deletedAt: null, userRoles: { some: { role: { key: "student" } } } },
    });
    if (!student) throw new Error("No seeded student user found — run `pnpm db:seed` first.");
    studentUserId = student.id;

    // Two independently-compiled + independently-init'd Nest applications sharing the
    // SAME Postgres + Redis — each gets its own NotificationsService singleton with its
    // own local sseSubscribers map and its own dedicated Redis pub/sub connection
    // (established in onModuleInit, which `app.init()` runs for real here).
    const moduleA = await Test.createTestingModule({ imports: [AppModule] }).compile();
    appA = moduleA.createNestApplication();
    await appA.init();
    notifSvcA = appA.get(NotificationsService);

    const moduleB = await Test.createTestingModule({ imports: [AppModule] }).compile();
    appB = moduleB.createNestApplication();
    await appB.init();
    notifSvcB = appB.get(NotificationsService);
  }, 60_000);

  afterAll(async () => {
    await appA?.close();
    await appB?.close();
    await prisma.$disconnect();
  });

  it("a notification created via instance A's notify() arrives on instance B's SSE subscriber", async () => {
    const [iterableB, unsubscribeB] = notifSvcB.subscribeToStream(studentUserId, tenantId);
    const iteratorB = iterableB[Symbol.asyncIterator]();

    try {
      // Give the async iterator + Redis subscription a moment to be fully registered
      // before the publish fires (avoids a flaky race on a cold connection).
      await new Promise((r) => setTimeout(r, 200));

      const notifyPromise = notifSvcA.notify(studentUserId, tenantId, "welcome", {
        userName: "R10 multi-instance test",
      });

      const nextEventPromise = iteratorB.next();
      const [, event] = await Promise.all([
        notifyPromise,
        Promise.race([nextEventPromise, timeoutAfter(10_000, "SSE cross-instance event")]),
      ]);

      const result = event as IteratorResult<{ data: { type: string }; event: string }>;
      expect(result.done).toBe(false);
      expect(result.value.event).toBe("notification");
      expect(result.value.data.type).toBe("welcome");
    } finally {
      unsubscribeB();
    }
  }, 20_000);

  it("a notification created via instance A's notify() does NOT leak to a DIFFERENT user's subscriber on instance B", async () => {
    const otherUser = await prisma.user.findFirst({
      where: { tenantId, deletedAt: null, id: { not: studentUserId } },
    });
    if (!otherUser) return; // no second user seeded — nothing to assert, skip silently

    const [iterableB, unsubscribeB] = notifSvcB.subscribeToStream(otherUser.id, tenantId);
    const iteratorB = iterableB[Symbol.asyncIterator]();

    try {
      await new Promise((r) => setTimeout(r, 200));

      await notifSvcA.notify(studentUserId, tenantId, "welcome", { userName: "should not leak" });

      const raced = await Promise.race([
        iteratorB.next().then(() => "delivered"),
        new Promise((r) => setTimeout(() => r("no-event"), 1_500)),
      ]);

      expect(raced).toBe("no-event");
    } finally {
      unsubscribeB();
    }
  }, 20_000);
});
