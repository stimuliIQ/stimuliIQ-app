// apps/api/src/modules/notifications/notifications.service.spec.ts
//
// Unit tests for NotificationsService (WS-1, docs/plans/phase-6.md task #6).
//
// Coverage (per task DoD + AC checklist):
//   AC-7:  all channels disabled → only in_app created
//   AC-8:  missing prefs → default prefs applied server-side
//   AC-9:  quiet hours defers non-urgent external channels
//   AC-10: urgent notification type bypasses quiet hours
//   AC-11: suppressed channel → provider NOT called
//   AC-5:  IDOR → 404 (markRead for another user's notification)
//   AC-21/24/77: unsubscribe token generate + verify + tamper rejection
//   AC-22: processUnsubscribe creates suppression row
//   AC-24: tampered token → BadRequestException INVALID_TOKEN
//   AC-14: SSE stream authentication (subscribeToStream own-scope)

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { NotificationsService, generateUnsubscribeToken, verifyUnsubscribeToken } from "./notifications.service";
import { NotificationsRepository } from "./notifications.repository";
import { NOTIFICATION_DISPATCH_PORT } from "./dispatch/notification-dispatch.port";
import { TemplateRegistry } from "./dispatch/template-registry";
import { RedisService } from "../../redis/redis.service";
import { __resetEnvCacheForTests } from "../../config/env";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRepo = {
  findPrefs: jest.fn(),
  isSuppressed: jest.fn(),
  createNotification: jest.fn(),
  markNotificationRead: jest.fn(),
  findNotificationById: jest.fn(),
  countUnread: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  upsertPrefs: jest.fn(),
  createSuppression: jest.fn(),
  findUserForUnsubscribe: jest.fn(),
  updateNotificationChannels: jest.fn(),
};

const mockDispatch = {
  dispatch: jest.fn(),
};

const mockTemplateRegistry = new TemplateRegistry();

// Minimal RedisService double for the T31/R10 SSE Redis pub/sub fan-out. `notify()`
// calls `ssePublish()` -> `redis.client.publish(...)` (best-effort, catches failures) —
// the tests never exercise `onModuleInit` (TestingModule.compile() alone does not run
// lifecycle hooks, only `moduleRef.init()` does), so `.duplicate()`/`.psubscribe()` are
// never actually invoked here, but are stubbed for type-shape completeness.
const mockRedisService = {
  client: {
    publish: jest.fn().mockResolvedValue(1),
    duplicate: jest.fn().mockReturnValue({
      on: jest.fn(),
      psubscribe: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    }),
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const NOTIF_ID = "00000000-0000-0000-0000-000000000003";

function makeNotifRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIF_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    type: "grade_ready",
    channels: { in_app: true, email: false, sms: false, whatsapp: false },
    payload: { assignmentTitle: "Test Assignment", score: "90" },
    readAt: null,
    createdAt: new Date("2026-07-03T10:00:00Z"),
    updatedAt: new Date("2026-07-03T10:00:00Z"),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NotificationsService", () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    __resetEnvCacheForTests();

    // Set required env vars
    process.env["NOTIFICATION_SIGNING_SECRET"] = "test-signing-secret-000000000000000000000000000000";
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    process.env["REDIS_URL"] = "redis://localhost";
    process.env["JWT_PRIVATE_KEY_PATH"] = "test-private.pem";
    process.env["JWT_PUBLIC_KEY_PATH"] = "test-public.pem";
    process.env["COOKIE_SECRET"] = "test-cookie-secret-00000000000000000000";
    process.env["CSRF_SECRET"] = "test-csrf-secret-000000000000000000000";

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: mockRepo },
        { provide: NOTIFICATION_DISPATCH_PORT, useValue: mockDispatch },
        { provide: TemplateRegistry, useValue: mockTemplateRegistry },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    __resetEnvCacheForTests();
    delete process.env["NOTIFICATION_SIGNING_SECRET"];
  });

  // ─── AC-8: Missing prefs → default prefs applied ──────────────────────────

  describe("notify() — AC-8: missing prefs → defaults applied", () => {
    it("applies default prefs (email=true) when no prefs row exists", async () => {
      mockRepo.findPrefs.mockResolvedValue(null); // no prefs row
      mockRepo.isSuppressed.mockResolvedValue(false);
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);
      mockDispatch.dispatch.mockResolvedValue({ dispatched: true, skipped: false, providerMessageId: "msg-1" });

      const result = await service.notify(USER_ID, TENANT_ID, "grade_ready", {
        assignmentTitle: "Test",
        score: "90",
        studentName: "Alice",
      }, { toEmail: "alice@example.com" });

      // in_app row was created
      expect(mockRepo.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "grade_ready", userId: USER_ID, tenantId: TENANT_ID }),
      );

      // email was dispatched (default prefs: email=true)
      expect(mockDispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email", toEmail: "alice@example.com" }),
      );

      expect(result.notificationId).toBe(NOTIF_ID);
    });
  });

  // ─── T31 / R10: SSE Redis pub/sub fan-out ──────────────────────────────────

  describe("notify() — R10: publishes to the shared Redis SSE channel", () => {
    it("publishes the notification to sse-notif:<tenantId>:<userId> after the in_app row is created", async () => {
      mockRepo.findPrefs.mockResolvedValue(null);
      mockRepo.isSuppressed.mockResolvedValue(false);
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);
      mockDispatch.dispatch.mockResolvedValue({ dispatched: false, skipped: true });

      await service.notify(USER_ID, TENANT_ID, "grade_ready", { assignmentTitle: "Test", score: "90" });

      expect(mockRedisService.client.publish).toHaveBeenCalledWith(
        `sse-notif:${TENANT_ID}:${USER_ID}`,
        expect.stringContaining(NOTIF_ID),
      );
    });

    it("does not throw when the Redis publish fails (best-effort, in_app row still succeeds)", async () => {
      mockRepo.findPrefs.mockResolvedValue(null);
      mockRepo.isSuppressed.mockResolvedValue(false);
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);
      mockDispatch.dispatch.mockResolvedValue({ dispatched: false, skipped: true });
      mockRedisService.client.publish.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await service.notify(USER_ID, TENANT_ID, "grade_ready", { assignmentTitle: "Test", score: "90" });

      expect(result.notificationId).toBe(NOTIF_ID);
    });
  });

  // ─── AC-7: All external channels disabled → only in_app ───────────────────

  describe("notify() — AC-7: all channels disabled → only in_app created", () => {
    it("does not call any external provider when all non-in_app channels disabled", async () => {
      mockRepo.findPrefs.mockResolvedValue({
        id: "pref-1",
        tenantId: TENANT_ID,
        userId: USER_ID,
        matrix: {
          grade_ready: { in_app: true, email: false, sms: false, whatsapp: false },
        },
        quietHours: null,
        updatedAt: new Date(),
      });
      mockRepo.isSuppressed.mockResolvedValue(false);
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);

      await service.notify(USER_ID, TENANT_ID, "grade_ready", { assignmentTitle: "Test", score: "90" });

      // No external dispatch calls
      expect(mockDispatch.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email" }),
      );
      expect(mockDispatch.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ channel: "sms" }),
      );
      expect(mockDispatch.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ channel: "whatsapp" }),
      );
      // in_app row was still created
      expect(mockRepo.createNotification).toHaveBeenCalled();
    });
  });

  // ─── AC-11: Suppressed channel → MailProvider NOT called ──────────────────

  describe("notify() — AC-11: suppressed channel skipped", () => {
    it("skips email dispatch when user is on suppression list for email", async () => {
      mockRepo.findPrefs.mockResolvedValue(null); // default prefs (email=true)
      // email is suppressed
      mockRepo.isSuppressed.mockImplementation(async (opts: { channel: string }) => opts.channel === "email");
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);

      await service.notify(USER_ID, TENANT_ID, "grade_ready", {
        assignmentTitle: "Test",
        score: "90",
      }, { toEmail: "student@example.com" });

      // email should NOT be dispatched
      expect(mockDispatch.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email" }),
      );
      // in_app row was still created
      expect(mockRepo.createNotification).toHaveBeenCalled();
    });
  });

  // ─── AC-9: Quiet hours defers non-urgent external channels ────────────────

  describe("notify() — AC-9: quiet hours defers non-urgent channels", () => {
    it("skips email dispatch during quiet hours for non-urgent type", async () => {
      // Set quiet hours to "always quiet" (00:00 – 23:59) to guarantee deferral
      mockRepo.findPrefs.mockResolvedValue({
        id: "pref-1",
        tenantId: TENANT_ID,
        userId: USER_ID,
        matrix: {
          announcement: { in_app: true, email: true, sms: false, whatsapp: false },
        },
        quietHours: { start: "00:00", end: "23:59", tz: "Asia/Kolkata" },
        updatedAt: new Date(),
      });
      mockRepo.isSuppressed.mockResolvedValue(false);
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);

      await service.notify(USER_ID, TENANT_ID, "announcement", {
        title: "Test Announcement",
        body: "Hello!",
      }, { toEmail: "student@example.com" });

      // email should be deferred (not dispatched) during quiet hours
      expect(mockDispatch.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email" }),
      );
      // in_app is always sent immediately
      expect(mockRepo.createNotification).toHaveBeenCalled();
    });
  });

  // ─── AC-10: Urgent type bypasses quiet hours ───────────────────────────────

  describe("notify() — AC-10: urgent type bypasses quiet hours", () => {
    it("dispatches certificate_ready email even during quiet hours", async () => {
      // Set quiet hours to "always quiet"
      mockRepo.findPrefs.mockResolvedValue({
        id: "pref-1",
        tenantId: TENANT_ID,
        userId: USER_ID,
        matrix: {
          certificate_ready: { in_app: true, email: true, sms: false, whatsapp: false },
        },
        quietHours: { start: "00:00", end: "23:59", tz: "Asia/Kolkata" },
        updatedAt: new Date(),
      });
      mockRepo.isSuppressed.mockResolvedValue(false);
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);
      mockDispatch.dispatch.mockResolvedValue({ dispatched: true, skipped: false, providerMessageId: "msg-cert" });

      await service.notify(USER_ID, TENANT_ID, "certificate_ready", {
        certificateId: "cert-1",
        programTitle: "Full Stack Dev",
        studentName: "Alice",
      }, { toEmail: "alice@example.com" });

      // certificate_ready is URGENT → email dispatched even during quiet hours
      expect(mockDispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email" }),
      );
    });
  });

  // ─── AC-5/IDOR: markRead returns 404 for another user's notification ───────

  describe("markRead() — AC-5: IDOR → 404", () => {
    it("throws NotFoundException when notification belongs to a different user", async () => {
      mockRepo.findNotificationById.mockResolvedValue(null); // not found for this user

      await expect(
        service.markRead("other-user-id", TENANT_ID, NOTIF_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockRepo.markNotificationRead).not.toHaveBeenCalled();
    });

    it("marks read successfully for the correct user", async () => {
      mockRepo.findNotificationById.mockResolvedValue(makeNotifRow());
      mockRepo.markNotificationRead.mockResolvedValue({ readAt: new Date() });
      mockRepo.countUnread.mockResolvedValue(2);

      const result = await service.markRead(USER_ID, TENANT_ID, NOTIF_ID);

      expect(result.unreadCount).toBe(2);
      expect(mockRepo.markNotificationRead).toHaveBeenCalledWith(TENANT_ID, USER_ID, NOTIF_ID);
    });
  });

  // ─── AC-21/24/77: Unsubscribe token generation and verification ───────────

  describe("Unsubscribe token", () => {
    it("AC-21: generates a signed HMAC token", () => {
      const token = generateUnsubscribeToken(USER_ID, "email");
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);
    });

    it("AC-24: verifyUnsubscribeToken returns null on tampered token", () => {
      const token = generateUnsubscribeToken(USER_ID, "email");
      // Flip the last character
      const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
      const result = verifyUnsubscribeToken(tampered);
      expect(result).toBeNull();
    });

    it("AC-77: verifies correctly on valid token", () => {
      const token = generateUnsubscribeToken(USER_ID, "email");
      const result = verifyUnsubscribeToken(token);
      expect(result).not.toBeNull();
      expect(result?.userId).toBe(USER_ID);
      expect(result?.channel).toBe("email");
    });

    it("returns null on completely invalid token", () => {
      expect(verifyUnsubscribeToken("not-a-valid-token")).toBeNull();
      expect(verifyUnsubscribeToken("")).toBeNull();
    });
  });

  // ─── AC-22: processUnsubscribe creates suppression row ────────────────────

  describe("processUnsubscribe() — AC-22", () => {
    it("creates a suppression row for a valid unsubscribe token", async () => {
      const token = generateUnsubscribeToken(USER_ID, "email");
      mockRepo.findUserForUnsubscribe.mockResolvedValue({
        id: USER_ID,
        email: "alice@example.com",
        phone: null,
        tenantId: TENANT_ID,
      });
      mockRepo.createSuppression.mockResolvedValue({
        id: "sup-1",
        tenantId: TENANT_ID,
        userId: USER_ID,
        email: "alice@example.com",
        phone: null,
        channel: "email",
        reason: "unsubscribe",
        createdAt: new Date(),
      });

      const result = await service.processUnsubscribe(token);

      expect(result.channel).toBe("email");
      expect(result.message).toContain("unsubscribed");
      expect(mockRepo.createSuppression).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          channel: "email",
          reason: "unsubscribe",
        }),
      );
    });

    it("AC-24: throws BadRequestException for tampered token", async () => {
      const token = generateUnsubscribeToken(USER_ID, "email");
      const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

      await expect(service.processUnsubscribe(tampered)).rejects.toThrow(BadRequestException);

      expect(mockRepo.createSuppression).not.toHaveBeenCalled();
    });
  });

  // ─── AC-14: SSE stream is own-scoped ─────────────────────────────────────
  // ─── P6 M-1 / Phase-7 Wave 2 batch B: tenant-namespaced key + connection cap ──

  const OTHER_TENANT_ID = "00000000-0000-0000-0000-0000000000ff";

  function makeStreamNotifDto(id: string = NOTIF_ID) {
    return {
      id,
      type: "grade_ready" as const,
      channels: { in_app: true, email: false, sms: false, whatsapp: false },
      payload: {},
      readAt: null,
      createdAt: new Date().toISOString(),
    };
  }

  /** Test-only accessor for the private emitSseEvent(tenantId, userId, notification). */
  function emitSse(tenantId: string, userId: string, notification: unknown): void {
    (service as unknown as { emitSseEvent: (t: string, u: string, d: unknown) => void }).emitSseEvent(
      tenantId,
      userId,
      notification,
    );
  }

  describe("subscribeToStream() — AC-14: own-scoped", () => {
    it("returns an async iterable and a cleanup function", () => {
      const [iterable, unsubscribe] = service.subscribeToStream(USER_ID, TENANT_ID);

      expect(typeof iterable[Symbol.asyncIterator]).toBe("function");
      expect(typeof unsubscribe).toBe("function");

      // Clean up
      unsubscribe();
    });

    it("delivers events only to the subscribed user", async () => {
      const delivered: Array<{ data: unknown }> = [];

      const [iterable, unsubscribe] = service.subscribeToStream(USER_ID, TENANT_ID);

      // Collect items in background
      const collector = (async () => {
        for await (const event of iterable) {
          delivered.push(event);
          break; // collect one event then stop
        }
      })();

      const notifDto = makeStreamNotifDto();
      // Trigger the private emitSseEvent (tenantId, userId, notification)
      emitSse(TENANT_ID, USER_ID, notifDto);

      await collector;
      unsubscribe();

      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toEqual({ data: notifDto, event: "notification" });
    });
  });

  describe("SSE cross-tenant isolation (P6 M-1, AC-61)", () => {
    it("does NOT deliver an event emitted under a different tenantId, even for the same userId", async () => {
      const delivered: Array<{ data: unknown }> = [];
      const [iterable, unsubscribe] = service.subscribeToStream(USER_ID, TENANT_ID);

      const collector = (async () => {
        for await (const event of iterable) {
          delivered.push(event);
          break;
        }
      })();

      // Emit under a DIFFERENT tenantId for the SAME userId — must not reach this subscriber.
      emitSse(OTHER_TENANT_ID, USER_ID, makeStreamNotifDto("wrong-tenant-notif"));

      // Now emit under the correct tenant — this one SHOULD arrive.
      const correctDto = makeStreamNotifDto("correct-tenant-notif");
      emitSse(TENANT_ID, USER_ID, correctDto);

      await collector;
      unsubscribe();

      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toEqual({ data: correctDto, event: "notification" });
    });

    it("two tenants' subscribers for the same userId are tracked independently", () => {
      const [, unsubA] = service.subscribeToStream(USER_ID, TENANT_ID);
      const [, unsubB] = service.subscribeToStream(USER_ID, OTHER_TENANT_ID);

      const map = (service as unknown as { sseSubscribers: Map<string, unknown[]> }).sseSubscribers;
      expect(map.get(`${TENANT_ID}:${USER_ID}`)?.length).toBe(1);
      expect(map.get(`${OTHER_TENANT_ID}:${USER_ID}`)?.length).toBe(1);

      unsubA();
      unsubB();
    });
  });

  describe("SSE per-user connection cap (P6 M-1, AC-62)", () => {
    afterEach(() => {
      delete process.env["SSE_MAX_CONNECTIONS_PER_USER"];
      __resetEnvCacheForTests();
    });

    it("evicts the OLDEST connection once the cap (default 3) is exceeded", async () => {
      const conn1 = service.subscribeToStream(USER_ID, TENANT_ID);
      const conn2 = service.subscribeToStream(USER_ID, TENANT_ID);
      const conn3 = service.subscribeToStream(USER_ID, TENANT_ID);

      const map = (service as unknown as { sseSubscribers: Map<string, unknown[]> }).sseSubscribers;
      expect(map.get(`${TENANT_ID}:${USER_ID}`)?.length).toBe(3);

      // A 4th connection should evict the oldest (conn1) rather than growing unbounded.
      const conn4 = service.subscribeToStream(USER_ID, TENANT_ID);
      expect(map.get(`${TENANT_ID}:${USER_ID}`)?.length).toBe(3);

      // conn1's iterator must be DONE (force-closed), not still waiting.
      const conn1Iterator = conn1[0][Symbol.asyncIterator]();
      const conn1Result = await conn1Iterator.next();
      expect(conn1Result.done).toBe(true);

      // conn2/conn3/conn4 remain live — an emitted event reaches all three, not conn1.
      const delivered2: unknown[] = [];
      const collector2 = (async () => {
        for await (const event of conn2[0]) {
          delivered2.push(event);
          break;
        }
      })();
      emitSse(TENANT_ID, USER_ID, makeStreamNotifDto());
      await collector2;
      expect(delivered2).toHaveLength(1);

      conn2[1]();
      conn3[1]();
      conn4[1]();
    });

    it("never accumulates more than the configured cap of entries for one user", () => {
      const cleanups: Array<() => void> = [];
      for (let i = 0; i < 10; i++) {
        const [, unsubscribe] = service.subscribeToStream(USER_ID, TENANT_ID);
        cleanups.push(unsubscribe);
      }

      const map = (service as unknown as { sseSubscribers: Map<string, unknown[]> }).sseSubscribers;
      expect(map.get(`${TENANT_ID}:${USER_ID}`)?.length).toBe(3);

      for (const cleanup of cleanups) cleanup();
      // After every connection unsubscribes, the map entry is fully cleaned up (no leak).
      expect(map.has(`${TENANT_ID}:${USER_ID}`)).toBe(false);
    });
  });

  describe("SSE cleanup (no leak on disconnect)", () => {
    it("removes the map entry entirely once the last subscriber for a key unsubscribes", () => {
      const [, unsubscribe] = service.subscribeToStream(USER_ID, TENANT_ID);
      const map = (service as unknown as { sseSubscribers: Map<string, unknown[]> }).sseSubscribers;
      expect(map.has(`${TENANT_ID}:${USER_ID}`)).toBe(true);

      unsubscribe();
      expect(map.has(`${TENANT_ID}:${USER_ID}`)).toBe(false);
    });
  });

  // ─── AC-6 (headline): grade_ready → in_app + email ───────────────────────

  describe("notify() — AC-6: grade_ready fan-out", () => {
    it("creates in_app row and dispatches email when opted-in and not suppressed", async () => {
      mockRepo.findPrefs.mockResolvedValue({
        id: "pref-1",
        tenantId: TENANT_ID,
        userId: USER_ID,
        matrix: {
          grade_ready: { in_app: true, email: true, sms: false, whatsapp: false },
        },
        quietHours: null,
        updatedAt: new Date(),
      });
      mockRepo.isSuppressed.mockResolvedValue(false);
      mockRepo.createNotification.mockResolvedValue(makeNotifRow());
      mockRepo.updateNotificationChannels.mockResolvedValue(undefined);
      mockDispatch.dispatch.mockResolvedValue({ dispatched: true, skipped: false, providerMessageId: "mail-123" });

      const result = await service.notify(
        USER_ID, TENANT_ID, "grade_ready",
        { assignmentTitle: "Quiz 1", score: "85", studentName: "Bob" },
        { toEmail: "bob@example.com" },
      );

      // in_app row created
      expect(mockRepo.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "grade_ready", userId: USER_ID }),
      );

      // email dispatched
      expect(mockDispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email", toEmail: "bob@example.com" }),
      );

      // whatsapp NOT dispatched (prefs: whatsapp=false)
      expect(mockDispatch.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ channel: "whatsapp" }),
      );

      // sms NOT dispatched (prefs: sms=false)
      expect(mockDispatch.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ channel: "sms" }),
      );

      expect(result.notificationId).toBe(NOTIF_ID);
    });
  });
});
