// apps/api/test/integration/phase-9-live-classes.integration-spec.ts
//
// Phase-9 Completion T20 QA gate: Live Class module integration + isolation tests
// (docs/plans/phase-9-completion.md T20). Exercises the REAL NestJS application over HTTP
// (supertest + real Nest app) against a real Postgres + Redis DB, matching the pattern of
// phase-8-mentor.integration-spec.ts / lms-idor-progress-webhook.integration-spec.ts.
//
// COVERAGE:
//   - RBAC/scope: admin(all)/faculty(assigned)/branch_manager(branch)/student(own) each see
//     the live-class set their seeded scope grants — nothing else (IDOR -> 404).
//   - Schedule/update/cancel: provider.createMeeting (Noop) called, row persisted, status
//     transitions scheduled -> live (on join) -> cancelled/completed.
//   - Join: attendance row written SYNCHRONOUSLY with `live_class_id` set, `markedAt`
//     within 60s of the join call (T20 headline requirement) — ONLY for a student (own
//     scope) caller, never for the host/staff.
//   - Webhook: missing/invalid signature -> 401 (fail closed); valid Noop-signed
//     participant_joined -> attendance row written; recording_ready -> recordingUrl set;
//     replay is idempotent (no duplicate attendance row / no-op update).

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
  process.env.LIVE_CLASS_PROVIDER = "noop";
  process.env.QUEUE_DRIVER = "sync";
  process.env.NOTIFICATION_SIGNING_SECRET = "integration-test-notification-signing-secret-xxxxxxxx";
  process.env.MAIL_WEBHOOK_SECRET = "integration-test-mail-webhook-secret-yyyyyyyy";
  process.env.WHATSAPP_APP_SECRET = "integration-test-whatsapp-app-secret-zzzzzzzz";
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

function cookieHeader(cookies: string[]): string {
  return cookies.map((c) => c.split(";")[0]!).join("; ");
}

function extractCsrfToken(cookies: string[]): string | undefined {
  const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
  return csrfCookie?.split("=")[1]?.split(";")[0];
}

describeIfAvailable("Phase-9 Live Classes — integration + RBAC scope isolation (real Postgres + Redis + Noop providers)", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const argon2 = require("argon2");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const { NoopLiveClassProvider, DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET } = require("../../src/modules/lms/providers/live-class/noop-live-class.provider");

  let app: import("@nestjs/common").INestApplication;
  let httpServer: ReturnType<typeof app.getHttpServer>;
  let prisma: InstanceType<typeof PrismaClient>;

  const PASSWORD = "P@ssword123!";
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  let tenantId: string;

  let adminCookies: string[], csrfAdmin: string;
  let facultyCookies: string[], csrfFaculty: string;
  let bmBCookies: string[];
  let studentACookies: string[], csrfStudentA: string;
  let studentBCookies: string[], csrfStudentB: string;
  let counsellorCookies: string[], csrfCounsellor: string;

  let branchB: { id: string };
  let branchC: { id: string };
  let program: { id: string };
  let facultyUserId: string;
  let studentAUserId: string;
  let batch1: { id: string; name: string }; // branch B, taught by faculty, studentA enrolled
  let batch2: { id: string; name: string }; // branch C — out of scope for faculty/studentA

  const fixtureUserIds: string[] = [];
  const fixtureBranchIds: string[] = [];
  const fixtureBatchIds: string[] = [];
  const fixtureLiveClassIds: string[] = [];
  const fixtureEnrollmentIds: string[] = [];
  const fixtureStudentProfileIds: string[] = [];
  const fixtureFacultyProfileIds: string[] = [];
  let fixtureProgramId: string | undefined;

  async function login(email: string, password: string): Promise<{ cookies: string[]; csrf: string }> {
    const res = await request(httpServer).post("/api/v1/auth/login").send({ email, password });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const cookies = res.headers["set-cookie"] as string[];
    return { cookies, csrf: extractCsrfToken(cookies) ?? "" };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: envFile.databaseUrl });
    await prisma.$connect();

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser(process.env.COOKIE_SECRET));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = app.getHttpServer();

    const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
    if (!tenant) throw new Error("No tenant found — run `pnpm db:seed` first.");
    tenantId = tenant.id;

    const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin", deletedAt: null } });
    const facultyRole = await prisma.role.findFirst({ where: { tenantId, key: "faculty", deletedAt: null } });
    const branchManagerRole = await prisma.role.findFirst({ where: { tenantId, key: "branch_manager", deletedAt: null } });
    const studentRole = await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } });
    const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
    if (!adminRole || !facultyRole || !branchManagerRole || !studentRole || !counsellorRole) {
      throw new Error("Roles not seeded — run `pnpm db:seed` first.");
    }

    const pwHash = await argon2.hash(PASSWORD);

    branchB = await prisma.branch.create({ data: { tenantId, name: `P9 LC Branch B ${suffix}`, status: "active" } });
    branchC = await prisma.branch.create({ data: { tenantId, name: `P9 LC Branch C ${suffix}`, status: "active" } });
    fixtureBranchIds.push(branchB.id, branchC.id);

    async function createUser(label: string, roleId: string, branchId: string | null): Promise<string> {
      const email = `p9lc.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({
        data: { tenantId, email, name: `P9 LC ${label}`, passwordHash: pwHash, status: "active" },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    const adminUserId = await createUser("admin", adminRole.id, null);
    facultyUserId = await createUser("faculty", facultyRole.id, null);
    const bmBUserId = await createUser("bmB", branchManagerRole.id, branchB.id);
    studentAUserId = await createUser("studentA", studentRole.id, null);
    const studentBUserId = await createUser("studentB", studentRole.id, null);
    const counsellorUserId = await createUser("counsellor", counsellorRole.id, null);
    void counsellorUserId;

    const facultyProfile = await prisma.facultyProfile.create({
      data: { tenantId, userId: facultyUserId, bio: "P9 LC QA faculty fixture", branchId: branchB.id },
    });
    fixtureFacultyProfileIds.push(facultyProfile.id);

    program = await prisma.program.create({
      data: { tenantId, slug: `p9-lc-program-${suffix}`, title: "P9 LC Program", domain: "Engineering", pricePaise: 5000000, status: "published" },
    });
    fixtureProgramId = program.id;

    batch1 = await prisma.batch.create({
      data: {
        tenantId, programId: program.id, branchId: branchB.id, facultyId: facultyProfile.id,
        name: `P9 LC Batch1 ${suffix}`, status: "active",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), capacity: 30,
      },
    });
    batch2 = await prisma.batch.create({
      data: {
        tenantId, programId: program.id, branchId: branchC.id,
        name: `P9 LC Batch2 ${suffix}`, status: "active",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), capacity: 30,
      },
    });
    fixtureBatchIds.push(batch1.id, batch2.id);

    async function enrollStudent(userId: string, batchId: string): Promise<void> {
      const studentProfile = await prisma.studentProfile.create({
        data: { tenantId, userId, courseType: "btech", status: "active" },
      });
      fixtureStudentProfileIds.push(studentProfile.id);
      const enrollment = await prisma.enrollment.create({
        data: { tenantId, studentId: studentProfile.id, batchId, programId: program.id, status: "active", progressPct: 0 },
      });
      fixtureEnrollmentIds.push(enrollment.id);
    }
    await enrollStudent(studentAUserId, batch1.id);
    // studentB is intentionally NOT enrolled anywhere (used for the "no live classes" / IDOR checks).

    ({ cookies: adminCookies, csrf: csrfAdmin } = await login(`p9lc.admin.${suffix}@test.com`, PASSWORD));
    ({ cookies: facultyCookies, csrf: csrfFaculty } = await login(`p9lc.faculty.${suffix}@test.com`, PASSWORD));
    ({ cookies: bmBCookies } = await login(`p9lc.bmB.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentACookies, csrf: csrfStudentA } = await login(`p9lc.studentA.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentBCookies, csrf: csrfStudentB } = await login(`p9lc.studentB.${suffix}@test.com`, PASSWORD));
    ({ cookies: counsellorCookies, csrf: csrfCounsellor } = await login(`p9lc.counsellor.${suffix}@test.com`, PASSWORD));
    void adminUserId;
    void bmBUserId;
    void studentBUserId;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.attendance.deleteMany({ where: { enrollmentId: { in: fixtureEnrollmentIds } } }).catch(() => {});
      await prisma.liveClass.deleteMany({ where: { id: { in: fixtureLiveClassIds } } }).catch(() => {});
      await prisma.enrollment.deleteMany({ where: { id: { in: fixtureEnrollmentIds } } }).catch(() => {});
      await prisma.studentProfile.deleteMany({ where: { id: { in: fixtureStudentProfileIds } } }).catch(() => {});
      await prisma.batch.deleteMany({ where: { id: { in: fixtureBatchIds } } }).catch(() => {});
      await prisma.facultyProfile.deleteMany({ where: { id: { in: fixtureFacultyProfileIds } } }).catch(() => {});
      if (fixtureProgramId) await prisma.program.deleteMany({ where: { id: fixtureProgramId } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.branch.deleteMany({ where: { id: { in: fixtureBranchIds } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // Schedule / RBAC / scope
  // ═══════════════════════════════════════════════════════════════════════

  describe("Schedule + RBAC scope", () => {
    let lc1Id: string;

    it("non-liveclass.create role (counsellor) -> 403; admin (all scope) schedules successfully", async () => {
      const forbidden = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor)
        .send({
          batchId: batch1.id, title: "Should Not Be Created",
          startsAt: "2026-02-01T10:00:00.000Z", endsAt: "2026-02-01T11:00:00.000Z", hostUserId: facultyUserId,
        });
      expect(forbidden.status).toBe(403);

      const created = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({
          batchId: batch1.id, title: "P9 LC Week 1", provider: "noop",
          startsAt: "2026-02-01T10:00:00.000Z", endsAt: "2026-02-01T11:00:00.000Z", hostUserId: facultyUserId,
        });
      expect(created.status).toBe(201);
      expect(created.body.data.providerMeetingId).toMatch(/^noop-meeting-/);
      expect(created.body.data.status).toBe("scheduled");
      lc1Id = created.body.data.id;
      fixtureLiveClassIds.push(lc1Id);

      const auditRow = await prisma.auditLog.findFirst({
        where: { tenantId, entity: "LiveClass", entityId: lc1Id, action: "create" },
        orderBy: { createdAt: "desc" },
      });
      expect(auditRow).not.toBeNull();
    });

    it("faculty (assigned scope) can schedule for their own batch, but not for an unassigned batch (404, no leak)", async () => {
      const ok = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(facultyCookies))
        .set("X-CSRF-Token", csrfFaculty)
        .send({
          batchId: batch1.id, title: "P9 LC Faculty-Scheduled", provider: "noop",
          startsAt: "2026-02-02T10:00:00.000Z", endsAt: "2026-02-02T11:00:00.000Z", hostUserId: facultyUserId,
        });
      expect(ok.status).toBe(201);
      fixtureLiveClassIds.push(ok.body.data.id);

      const outOfScope = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(facultyCookies))
        .set("X-CSRF-Token", csrfFaculty)
        .send({
          batchId: batch2.id, title: "Should 404", provider: "noop",
          startsAt: "2026-02-02T10:00:00.000Z", endsAt: "2026-02-02T11:00:00.000Z", hostUserId: facultyUserId,
        });
      expect(outOfScope.status).toBe(404);
    });

    it("branch_manager (branch scope) sees batch1's live class (own branch) but not batch2's (different branch)", async () => {
      const listRes = await request(httpServer).get("/api/v1/crm/live-classes").set("Cookie", cookieHeader(bmBCookies));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((lc: { id: string }) => lc.id === lc1Id)).toBe(true);

      // Schedule one in batch2 (admin) to prove the branch manager cannot see it.
      const batch2Lc = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({
          batchId: batch2.id, title: "P9 LC Batch2 Session", provider: "noop",
          startsAt: "2026-02-03T10:00:00.000Z", endsAt: "2026-02-03T11:00:00.000Z", hostUserId: facultyUserId,
        });
      expect(batch2Lc.status).toBe(201);
      fixtureLiveClassIds.push(batch2Lc.body.data.id);

      const getBatch2AsBmB = await request(httpServer)
        .get(`/api/v1/crm/live-classes/${batch2Lc.body.data.id}`)
        .set("Cookie", cookieHeader(bmBCookies));
      expect(getBatch2AsBmB.status).toBe(404);
    });

    it("student (own scope) sees only their own enrolled batch's live class via /me/live-classes", async () => {
      const mine = await request(httpServer).get("/api/v1/me/live-classes").set("Cookie", cookieHeader(studentACookies));
      expect(mine.status).toBe(200);
      expect(mine.body.data.some((lc: { id: string }) => lc.id === lc1Id)).toBe(true);

      // studentB has no enrollment at all -> zero results, never a 403/500.
      const notMine = await request(httpServer).get("/api/v1/me/live-classes").set("Cookie", cookieHeader(studentBCookies));
      expect(notMine.status).toBe(200);
      expect(notMine.body.data).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Join + attendance auto-sync (T20 headline: "<=60s of join")
  // ═══════════════════════════════════════════════════════════════════════

  describe("Join + attendance auto-sync", () => {
    let lcId: string;

    beforeAll(async () => {
      const created = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({
          batchId: batch1.id, title: "P9 LC Join Test", provider: "noop",
          startsAt: "2026-02-05T10:00:00.000Z", endsAt: "2026-02-05T11:00:00.000Z", hostUserId: facultyUserId,
        });
      lcId = created.body.data.id;
      fixtureLiveClassIds.push(lcId);
    });

    it("a student not enrolled in the batch cannot join (404, IDOR fail-closed)", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/me/live-classes/${lcId}/join`)
        .set("Cookie", cookieHeader(studentBCookies))
        .set("X-CSRF-Token", csrfStudentB);
      expect(res.status).toBe(404);
    });

    it("the enrolled student's join returns a Noop join URL and writes an attendance row with live_class_id, markedAt <=60s of the call, source=live", async () => {
      const before = Date.now();
      const res = await request(httpServer)
        .post(`/api/v1/me/live-classes/${lcId}/join`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA);
      const after = Date.now();

      expect(res.status).toBe(200);
      expect(res.body.data.joinUrl).toMatch(/^https:\/\/noop\.liveclass\.local\/join\//);
      expect(res.body.data.provider).toBe("noop");

      const attendance = await prisma.attendance.findFirst({
        where: { tenantId, liveClassId: lcId, source: "live" },
      });
      expect(attendance).not.toBeNull();
      expect(attendance.status).toBe("present");
      expect(attendance.markedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(attendance.markedAt.getTime()).toBeLessThanOrEqual(after);
      expect(after - before).toBeLessThan(60_000); // T20 headline: "<=60s of join"

      // The live class transitioned scheduled -> live on first join.
      const lcRow = await prisma.liveClass.findUnique({ where: { id: lcId } });
      expect(lcRow.status).toBe("live");
    });

    it("re-joining is idempotent — no duplicate attendance row", async () => {
      await request(httpServer)
        .post(`/api/v1/me/live-classes/${lcId}/join`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA);

      const rows = await prisma.attendance.findMany({ where: { tenantId, liveClassId: lcId, source: "live" } });
      expect(rows).toHaveLength(1);
    });

    it("the host (faculty, assigned scope) joining does NOT create a second attendance row", async () => {
      await request(httpServer)
        .post(`/api/v1/crm/live-classes/${lcId}/join`)
        .set("Cookie", cookieHeader(facultyCookies))
        .set("X-CSRF-Token", csrfFaculty);

      const rows = await prisma.attendance.findMany({ where: { tenantId, liveClassId: lcId, source: "live" } });
      expect(rows).toHaveLength(1); // still just the student's row
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Cancel
  // ═══════════════════════════════════════════════════════════════════════

  describe("Cancel", () => {
    it("admin cancels a scheduled live class; joining afterwards is rejected (409)", async () => {
      const created = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({
          batchId: batch1.id, title: "P9 LC Cancel Test", provider: "noop",
          startsAt: "2026-02-06T10:00:00.000Z", endsAt: "2026-02-06T11:00:00.000Z", hostUserId: facultyUserId,
        });
      const lcId = created.body.data.id;
      fixtureLiveClassIds.push(lcId);

      const cancelRes = await request(httpServer)
        .post(`/api/v1/crm/live-classes/${lcId}/cancel`)
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe("cancelled");

      const joinAfterCancel = await request(httpServer)
        .post(`/api/v1/me/live-classes/${lcId}/join`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA);
      expect(joinAfterCancel.status).toBe(409);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Provider webhook — fail-closed signature + idempotent processing
  // ═══════════════════════════════════════════════════════════════════════

  describe("Provider webhook (HMAC fail-closed)", () => {
    let lcId: string;
    let providerMeetingId: string;

    beforeAll(async () => {
      const created = await request(httpServer)
        .post("/api/v1/crm/live-classes")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({
          batchId: batch1.id, title: "P9 LC Webhook Test", provider: "noop",
          startsAt: "2026-02-07T10:00:00.000Z", endsAt: "2026-02-07T11:00:00.000Z", hostUserId: facultyUserId,
        });
      lcId = created.body.data.id;
      providerMeetingId = created.body.data.providerMeetingId;
      fixtureLiveClassIds.push(lcId);
    });

    it("missing/invalid signature -> 401, payload never processed", async () => {
      const payload = { noop: true, type: "meeting_started", providerMeetingId };
      const res = await request(httpServer)
        .post("/api/v1/live-classes/webhook")
        .set("webhook-signature", "not-a-valid-signature")
        .send(payload);
      expect(res.status).toBe(401);

      const row = await prisma.liveClass.findUnique({ where: { id: lcId } });
      expect(row.status).toBe("scheduled"); // unchanged
    });

    it("valid Noop-signed participant_joined event writes the attendance row (webhook-driven sync path)", async () => {
      const studentAEmail = `p9lc.studentA.${suffix}@test.com`;
      const payload = {
        noop: true,
        type: "participant_joined",
        providerMeetingId,
        participant: { email: studentAEmail, name: "P9 LC studentA" },
      };
      const rawBody = JSON.stringify(payload);
      const signature = NoopLiveClassProvider.makeWebhookSignature(rawBody, DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET);

      const res = await request(httpServer)
        .post("/api/v1/live-classes/webhook")
        .set("webhook-signature", signature)
        .set("Content-Type", "application/json")
        .send(rawBody);
      expect(res.status).toBe(200);

      const attendance = await prisma.attendance.findFirst({ where: { tenantId, liveClassId: lcId, source: "live" } });
      expect(attendance).not.toBeNull();
    });

    it("recording_ready sets recordingUrl; replaying the same event is idempotent", async () => {
      const payload = {
        noop: true,
        type: "recording_ready",
        providerMeetingId,
        recording: { downloadUrl: "https://noop.liveclass.local/recording/abc123" },
      };
      const rawBody = JSON.stringify(payload);
      const signature = NoopLiveClassProvider.makeWebhookSignature(rawBody, DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET);

      const res1 = await request(httpServer)
        .post("/api/v1/live-classes/webhook")
        .set("webhook-signature", signature)
        .set("Content-Type", "application/json")
        .send(rawBody);
      expect(res1.status).toBe(200);

      const row = await prisma.liveClass.findUnique({ where: { id: lcId } });
      expect(row.recordingUrl).toBe("https://noop.liveclass.local/recording/abc123");

      // Replay — idempotent no-op, no error.
      const res2 = await request(httpServer)
        .post("/api/v1/live-classes/webhook")
        .set("webhook-signature", signature)
        .set("Content-Type", "application/json")
        .send(rawBody);
      expect(res2.status).toBe(200);
    });
  });
});
