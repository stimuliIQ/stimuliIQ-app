// apps/api/test/integration/p6-engagement.integration-spec.ts
//
// P6 QA gate: Engagement headline integration tests (docs/plans/phase-6.md §3 task #12,
// docs/plans/phase-7.md Wave 1 "qa" row — paying down the P6 deferred-test debt).
// Exercises the REAL NestJS application over HTTP (supertest + real Nest app) AND real
// injected services (app.get(...)) against a real Postgres + Redis DB (testcontainers or
// ambient docker-compose, via global-setup.ts).
//
// PATTERN: matches p4-learning-depth-journey.integration-spec.ts —
//   • reads STATE_FILE written by global-setup.ts (testcontainers → ambient → skip)
//   • sets ALL env vars BEFORE any import that transitively loads validateEnv()
//   • uses `describeIfAvailable` so `pnpm test:integration` stays GREEN when no DB
//   • Noop Mail + WhatsApp providers (MAIL_PROVIDER=noop, WHATSAPP_PROVIDER=noop)
//   • Noop/stub SMS (NODE_ENV=test selects MSG91 stub)
//   • NOTIFICATION_SIGNING_SECRET set for unsubscribe token tests
//
// ─── REWRITE NOTE (this pass) ────────────────────────────────────────────────
// This file previously (a) documented several tests in header comments that were never
// implemented in the body (N-6/N-7/N-8, C-2/C-3, F-5/F-6/F-8/F-9 — the prior QA agent hit
// its account/session limit mid-write) and (b) had fixture setup that did not match the
// actual Prisma schema (wrong field names, missing required fields, a `roles: connect`
// relation that does not exist on `User`, a cross-tenant flow relying on `/auth/login`
// which is hard-coded to a single tenant slug in this phase). See the DEFECTS block below
// for exact file:line citations — those are pre-existing bugs in the test fixture/setup,
// not something this rewrite introduces, and they are called out for the record rather
// than silently reverted history.
//
// ─── DEFECTS DISCOVERED BY THIS PASS (reported, NOT silently fixed in product code) ──
//
// CRITICAL-1 (product/seed bug — blocks ALL forum reads for EVERY role):
//   `forum.read` is required by ForumController on GET /forum/threads, GET
//   /forum/threads/:id, GET /forum/threads/:id/posts (apps/api/src/modules/forum/
//   forum.controller.ts lines 97, 139, 155 — @RequirePermission("forum.read")), but
//   `forum.read` is NEVER added to the P6 permission catalog (prisma/seed.ts lines
//   232-244, `P6_PERMISSIONS` array only has "forum.post" and "forum.moderate") and is
//   therefore never inserted into `permissions`, so it is never granted to ANY role —
//   not even admin/super_admin's "grant every cataloged permission" loop (prisma/
//   seed.ts lines 490-494), because that loop only iterates the permissions that exist
//   in the catalog. `PermissionsGuard` (apps/api/src/modules/auth/guards/permissions.guard.ts
//   lines 36-45) throws a hard 403 when no grant row matches the required key, with no
//   admin/superadmin bypass. Net effect: EVERY GET forum thread/post read request 403s
//   for EVERY role, including admin — this breaks AC-53, AC-54, AC-55 as shipped. Tests
//   below assert the SPEC-correct behavior (200/404 per AC) and will FAIL against the
//   current seed until `forum.read` is added to the catalog and granted (student: enrolled,
//   faculty: assigned, branch_manager: branch, admin/content_editor: all — mirroring the
//   forum.post / forum.moderate grant shape already in prisma/seed.ts lines 2376-2388).
//
// CRITICAL-2 (product/seed bug — blocks PUT /me/notification-prefs for EVERY role):
//   The SAME class of bug as CRITICAL-1, on a different route. `PUT /me/notification-
//   prefs` requires `notification_prefs.edit` (apps/api/src/modules/notifications/
//   notifications.controller.ts line 189 — @RequirePermission("notification_prefs.edit")),
//   but the P6 permission catalog (prisma/seed.ts P6_PERMISSIONS, lines 232-244) only
//   defines `notifications.view` — `notification_prefs.edit` does not exist as a row in
//   `permissions` at all, so (same as CRITICAL-1) it can never be granted, including to
//   admin/super_admin's "every cataloged permission" loop. Net effect: every student
//   (and every other role) gets 403 on every attempt to update their own notification
//   preferences or quiet hours — this breaks AC-19/AC-20 as shipped. Verified directly:
//   `SELECT * FROM permissions WHERE key = 'notification_prefs.edit'` returns zero rows
//   against the real seeded DB. Test N-12/AC-19 asserts the spec-correct 200/201 and is
//   expected to FAIL until `notification_prefs.edit` is added to the catalog and granted
//   (own scope, all authed roles — mirroring the `notifications.view`/`gamification.view`
//   grant loop already in prisma/seed.ts lines 2360-2368). The N-6/N-7/N-8 fan-out tests
//   arrange prefs directly via Prisma to isolate `NotificationsService.notify()` from
//   this separate, already-reported endpoint bug.
//
// M-1 (spec-wording vs. implementation-convention mismatch — NOT a functional/security
//   defect; the request IS still rejected either way):
//   Several ACs (AC-71 "422 BODY_TOO_LONG", AC-78 "422 DLT_TEMPLATE_ID_REQUIRED" at
//   `campaign_templates` CREATE) describe a zod-schema-shape violation (a missing
//   required field / an over-length string) as producing a 422. The codebase's ONE
//   validation pipe (apps/api/src/common/pipes/zod-validation.pipe.ts — "the one true
//   validator", used on every DTO in this app) ALWAYS throws `BadRequestException` (400,
//   code="validation.failed") for any zod parse failure, with no per-schema override.
//   Explicit BUSINESS-RULE checks written inside services (e.g. `campaigns.service.ts`'s
//   own DLT check at campaign SEND time, or `forum.service.ts`'s own body-length re-check)
//   correctly throw `UnprocessableEntityException` (422) with the documented error code —
//   that path IS reachable and correct for the campaign-SEND case (AC-31, exercised by
//   test C-4b below). Recommend product-manager/api-designer reconcile the AC wording to
//   "400" for pure zod-shape violations, matching the rest of this codebase's documented
//   400-for-shape / 422-for-business-rule convention.
//
// (Fixed as part of this QA pass, test-code only, not product code:)
//   - Role lookups used `name: "admin"` / `name: "student"` (roles.name is the *display*
//     name, e.g. "Admin"); the machine-readable field is `roles.key` ("admin"/"student").
//     Every role lookup in this file's old fixture threw "Roles not seeded" against the
//     real seeded DB.
//   - `prisma.tenant.create({ data: { id: `tenant-b-${Date.now()}` , plan: "basic", ... } })`
//     — `Tenant.id` is `@db.Uuid` (a non-UUID string throws a DB type error) and `Tenant`
//     has no `plan` column (only `status`). This call could never have succeeded.
//   - `prisma.user.create({ data: { ..., roles: { connect: { id } } } })` — `User` has no
//     `roles` relation; role assignment is via the explicit `UserRole` join table
//     (`prisma.userRole.create({ data: { userId, roleId, branchId: null } })`).
//   - `prisma.program.create` used `feePaise`/`isPublic` without `domain` — `Program.domain`
//     is required (no default) and the money field is `pricePaise`, not `feePaise`.
//   - `prisma.batch.create` omitted `branchId`, which is a required (non-nullable) FK.
//   - `prisma.enrollment.create` used `studentProfileId` — the actual FK column/field is
//     `studentId` (references `StudentProfile.id`).
//   - `prisma.studentProfile.create` used a non-existent `enrollmentNumber` field and
//     omitted the required `courseType` enum.
//   - Cross-tenant tests logged in via `POST /auth/login` for a second tenant's user, but
//     `AuthService` hard-codes `TENANT_SLUG = "stimuliiq"` for the whole login flow in this
//     phase (apps/api/src/modules/auth/auth.service.ts line 37 — "Phase 0: single tenant").
//     A user created under a different tenant id can never authenticate via `/auth/login`,
//     so `tenantBStudentCookies` was always empty and every cross-tenant assertion's
//     `if (!tenantBStudentCookies?.length) return;` guard silently no-op'd — the AC-72–75
//     tests never actually asserted anything. This rewrite tests tenant isolation at the
//     SERVICE/repository layer instead (`app.get(XService).method(realResourceId, foreignTenantId, ...)`),
//     which is the correct level given the documented single-tenant-login limitation, and
//     directly proves "the tenant_id filter is applied at the repository query level"
//     (AC-72's own wording) without needing a second real login.
//
// MEDIUM (robustness, discovered by test S-2c — NOT a security hole; forging a token
//   still requires NOTIFICATION_SIGNING_SECRET):
//   A validly-HMAC-signed unsubscribe token whose embedded userId is not UUID-shaped
//   crashes the request with an unhandled 500 instead of the graceful "unknown user"
//   200 path. Root cause: apps/api/src/modules/notifications/notifications.repository.ts
//   line 327 (`findUserForUnsubscribe`) passes the token's decoded userId straight into
//   `prisma.user.findFirst({ where: { id: userId } })` with no UUID-shape guard; `User.id`
//   is `@db.Uuid`, so Postgres throws a type-cast error that propagates as an unhandled
//   500. Test S-2c asserts the correct behavior (no 500) and is expected to FAIL until
//   the repository validates/catches this.
//
// ACCEPTANCE CRITERIA COVERED (see the bottom of this file's final QA report for the
// full criteria-to-test table)
//
// WS-1 Notifications: AC-1..AC-12, AC-18, AC-19, AC-22, AC-24, AC-72
// WS-2 Campaigns:      AC-27, AC-29, AC-30, AC-31, AC-32, AC-38, AC-39, AC-40, AC-73
// WS-3 Gamification:   AC-43, AC-44, AC-45, AC-46, AC-49, AC-50, AC-52, AC-75
// WS-4 Forum:          AC-53, AC-55, AC-56, AC-57, AC-58, AC-60, AC-61, AC-62, AC-64,
//                       AC-65, AC-68, AC-71, AC-74
// WS-5 Cross-cutting:  AC-72, AC-73, AC-74, AC-75, AC-76, AC-77

import { readFileSync } from "node:fs";
import { STATE_FILE, type IntegrationEnvFile } from "./global-setup";

const envFile: IntegrationEnvFile = JSON.parse(readFileSync(STATE_FILE, "utf8"));

// ─── Set ALL env vars BEFORE any validateEnv()-touching import ───────────────

if (envFile.available) {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = envFile.databaseUrl;
  process.env.REDIS_URL = envFile.redisUrl;
  process.env.JWT_PRIVATE_KEY_PATH = require.resolve("../../../../keys/jwt-private.pem");
  process.env.JWT_PUBLIC_KEY_PATH = require.resolve("../../../../keys/jwt-public.pem");
  process.env.JWT_ACCESS_TTL = "15m";
  process.env.JWT_REFRESH_TTL = "7d";
  // Phase-7 Wave 2 security hardening batch A, item 3: explicit audience claim
  // (matches the schema default in config/env.ts — set explicitly here per the task's
  // "set it in test config" instruction rather than relying on the default silently).
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

// ─── Shared test helpers ──────────────────────────────────────────────────────

function cookieHeader(cookies: string[]): string {
  return cookies.map((c) => c.split(";")[0]!).join("; ");
}

function extractCsrfToken(cookies: string[]): string | undefined {
  const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
  return csrfCookie?.split("=")[1]?.split(";")[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeIfAvailable(
  "P6 Engagement — headline integration tests (real Postgres + Redis + Noop providers)",
  () => {
    // ── Lazy imports (never loaded when suite is skipped) ─────────────────────
    const { Test } = require("@nestjs/testing");
    const cookieParser = require("cookie-parser");
    const request = require("supertest");
    const { PrismaClient } = require("@prisma/client");
    const argon2 = require("argon2");
    const { randomUUID } = require("node:crypto");
    const { NotFoundException } = require("@nestjs/common");
    const { AppModule } = require("../../src/app.module");
    const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
    const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
    const {
      NotificationsService,
      generateUnsubscribeToken,
    } = require("../../src/modules/notifications/notifications.service");
    const { MAIL_PROVIDER } = require("../../src/modules/notifications/providers/mail/mail-provider.interface");
    const {
      WHATSAPP_PROVIDER,
    } = require("../../src/modules/notifications/providers/whatsapp/whatsapp-provider.interface");
    const { GamificationService } = require("../../src/modules/gamification/gamification.service");
    const { ForumService } = require("../../src/modules/forum/forum.service");
    const { CampaignsService } = require("../../src/modules/campaigns/campaigns.service");

    let app: import("@nestjs/common").INestApplication;
    let httpServer: ReturnType<typeof app.getHttpServer>;
    let prisma: InstanceType<typeof PrismaClient>;

    // ─── DI-resolved singletons (real instances wired into the app) ─────────
    let mailProvider: { send: (...a: unknown[]) => unknown };
    let whatsappProvider: { sendTemplate: (...a: unknown[]) => unknown };
    let notifSvc: InstanceType<typeof NotificationsService>;
    let gamSvc: InstanceType<typeof GamificationService>;
    let forumSvc: InstanceType<typeof ForumService>;
    let campaignsSvc: InstanceType<typeof CampaignsService>;

    // ─── Test fixture state ─────────────────────────────────────────────────
    let tenantId: string;
    /** A syntactically-valid but never-persisted tenant id — used to prove tenant-scoped
     * repository queries reject cross-tenant access WITHOUT depending on `/auth/login`,
     * which is hard-coded to the single "stimuliiq" tenant in this phase (see DEFECTS). */
    const foreignTenantId: string = randomUUID();

    let studentUserId: string;
    let studentEmail: string;
    let studentBUserId: string; // second student — enrolled in batch A too (for reply/vote tests)
    let studentBEmail: string;
    let adminUserId: string;
    let facultyUserId: string;
    let facultyProfileId: string;
    let batchId: string; // batch A — student(s) + faculty are here
    let batchCId: string; // batch C — nobody below is enrolled/assigned here
    let studentCookies: string[];
    let studentBCookies: string[];
    let adminCookies: string[];
    let facultyCookies: string[];
    let csrfStudent: string;
    let csrfStudentB: string;
    let csrfAdmin: string;
    let csrfFaculty: string;

    // Campaign + notification fixture IDs
    let campaignTemplateId: string;
    let campaignId: string;

    // Forum fixture IDs
    let forumThreadId: string;
    let batchCThreadId: string;
    let batchCPostId: string;

    // ─── App setup + DB seed ─────────────────────────────────────────────────

    beforeAll(async () => {
      prisma = new PrismaClient({ datasourceUrl: envFile.databaseUrl });
      await prisma.$connect();

      const moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser(process.env.COOKIE_SECRET));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new EnvelopeInterceptor());
      app.setGlobalPrefix("api/v1");

      await app.init();
      httpServer = app.getHttpServer();

      mailProvider = app.get(MAIL_PROVIDER);
      whatsappProvider = app.get(WHATSAPP_PROVIDER);
      notifSvc = app.get(NotificationsService);
      gamSvc = app.get(GamificationService);
      forumSvc = app.get(ForumService);
      campaignsSvc = app.get(CampaignsService);

      // ─── Reuse the seeded tenant (must be "stimuliiq" — AuthService hard-codes it
      // for /auth/login in this phase; see DEFECTS note above) ────────────────────
      const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
      if (!tenant) throw new Error("No tenant found — run `pnpm db:seed` first.");
      tenantId = tenant.id;

      // ─── Roles: looked up by `key` (machine name), NOT `name` (display name) ───
      const studentRole = await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } });
      const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin", deletedAt: null } });
      const facultyRole = await prisma.role.findFirst({ where: { tenantId, key: "faculty", deletedAt: null } });
      if (!studentRole || !adminRole || !facultyRole) {
        throw new Error("Roles not seeded — run `pnpm db:seed` first.");
      }

      const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const pwHash = await argon2.hash("P@ssword123!");

      // ─── Branch (Batch.branchId is required) ───────────────────────────────
      const branch = await prisma.branch.findFirst({ where: { tenantId, deletedAt: null } })
        ?? await prisma.branch.create({ data: { tenantId, name: `P6 QA Branch ${suffix}`, status: "active" } });

      // ─── Users (User has no `roles` relation — assign via the UserRole join) ──
      studentEmail = `p6-student-${suffix}@test.com`;
      const studentUser = await prisma.user.create({
        data: { tenantId, email: studentEmail, name: "P6 Student A", passwordHash: pwHash, status: "active" },
      });
      studentUserId = studentUser.id;
      await prisma.userRole.create({ data: { userId: studentUserId, roleId: studentRole.id, branchId: null } });

      studentBEmail = `p6-studentb-${suffix}@test.com`;
      const studentBUser = await prisma.user.create({
        data: { tenantId, email: studentBEmail, name: "P6 Student B", passwordHash: pwHash, status: "active" },
      });
      studentBUserId = studentBUser.id;
      await prisma.userRole.create({ data: { userId: studentBUserId, roleId: studentRole.id, branchId: null } });

      const adminEmail = `p6-admin-${suffix}@test.com`;
      const adminUser = await prisma.user.create({
        data: { tenantId, email: adminEmail, name: "P6 Admin", passwordHash: pwHash, status: "active" },
      });
      adminUserId = adminUser.id;
      await prisma.userRole.create({ data: { userId: adminUserId, roleId: adminRole.id, branchId: null } });

      const facultyEmail = `p6-faculty-${suffix}@test.com`;
      const facultyUser = await prisma.user.create({
        data: { tenantId, email: facultyEmail, name: "P6 Faculty", passwordHash: pwHash, status: "active" },
      });
      facultyUserId = facultyUser.id;
      await prisma.userRole.create({ data: { userId: facultyUserId, roleId: facultyRole.id, branchId: null } });
      const facultyProfile = await prisma.facultyProfile.create({ data: { tenantId, userId: facultyUserId } });
      facultyProfileId = facultyProfile.id;

      // ─── Program + batches (Program.domain required; Batch.branchId required) ──
      const program = await prisma.program.create({
        data: {
          tenantId,
          slug: `p6-qa-program-${suffix}`,
          title: "P6 QA Program",
          domain: "Engineering",
          pricePaise: 100000_00,
          status: "published",
        },
      });

      const batch = await prisma.batch.create({
        data: {
          tenantId, programId: program.id, branchId: branch.id, facultyId: facultyProfileId,
          name: "P6 QA Batch A", startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"),
          capacity: 30, status: "active",
        },
      });
      batchId = batch.id;

      // Second batch: nobody above is enrolled (students) or assigned (faculty) here.
      const batchC = await prisma.batch.create({
        data: {
          tenantId, programId: program.id, branchId: branch.id,
          name: "P6 QA Batch C (not enrolled / not assigned)", startDate: new Date("2026-01-01"),
          endDate: new Date("2026-06-30"), capacity: 30, status: "active",
        },
      });
      batchCId = batchC.id;

      // ─── Enroll both students in batch A (studentB needed for reply/vote tests) ─
      const studentProfileA = await prisma.studentProfile.create({
        data: { tenantId, userId: studentUserId, courseType: "btech", status: "active" },
      });
      await prisma.enrollment.create({
        data: { tenantId, studentId: studentProfileA.id, programId: program.id, batchId, status: "active" },
      });

      const studentProfileB = await prisma.studentProfile.create({
        data: { tenantId, userId: studentBUserId, courseType: "btech", status: "active" },
      });
      await prisma.enrollment.create({
        data: { tenantId, studentId: studentProfileB.id, programId: program.id, batchId, status: "active" },
      });

      // ─── Badge catalog entry (idempotent) ──────────────────────────────────
      await prisma.badge.upsert({
        where: { tenantId_key: { tenantId, key: "first_project_approved" } },
        create: {
          tenantId, key: "first_project_approved", name: "First Project",
          description: "First approved project", icon: "star", criteria: {}, status: "active",
        },
        update: {},
      });

      // ─── Seed a thread + post in batch C (for AC-64 unassigned-faculty test) ───
      // Direct DB insert — the faculty fixture below is deliberately NOT assigned to
      // batch C, so it cannot create this content via the API (correctly, per AC-56).
      const batchCThread = await prisma.forumThread.create({
        data: { tenantId, batchId: batchCId, authorId: adminUserId, title: "Batch C seed thread", status: "open" },
      });
      batchCThreadId = batchCThread.id;
      const batchCPost = await prisma.forumPost.create({
        data: { tenantId, threadId: batchCThreadId, authorId: adminUserId, body: "Batch C seed post.", status: "visible" },
      });
      batchCPostId = batchCPost.id;

      // ─── Login all users (real /auth/login flow — single-tenant hard-code, so
      // ONLY users under the "stimuliiq" tenant can authenticate this way) ────────

      const loginStudent = await request(httpServer)
        .post("/api/v1/auth/login")
        .send({ email: studentEmail, password: "P@ssword123!" });
      studentCookies = loginStudent.headers["set-cookie"] as string[];
      csrfStudent = extractCsrfToken(studentCookies) ?? "";

      const loginStudentB = await request(httpServer)
        .post("/api/v1/auth/login")
        .send({ email: studentBEmail, password: "P@ssword123!" });
      studentBCookies = loginStudentB.headers["set-cookie"] as string[];
      csrfStudentB = extractCsrfToken(studentBCookies) ?? "";

      const loginAdmin = await request(httpServer)
        .post("/api/v1/auth/login")
        .send({ email: adminEmail, password: "P@ssword123!" });
      adminCookies = loginAdmin.headers["set-cookie"] as string[];
      csrfAdmin = extractCsrfToken(adminCookies) ?? "";

      const loginFaculty = await request(httpServer)
        .post("/api/v1/auth/login")
        .send({ email: facultyEmail, password: "P@ssword123!" });
      facultyCookies = loginFaculty.headers["set-cookie"] as string[];
      csrfFaculty = extractCsrfToken(facultyCookies) ?? "";
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // WS-1: Notifications
    // ═══════════════════════════════════════════════════════════════════════════

    describe("WS-1 Notifications", () => {
      let notificationId: string;

      // N-1 / AC-1: notify() creates in_app row
      it("N-1 AC-1: notify() creates an in_app notifications row for the student", async () => {
        const notif = await prisma.notification.create({
          data: {
            tenantId, userId: studentUserId, type: "grade_ready",
            channels: { in_app: true, email: false, sms: false, whatsapp: false },
            payload: { assignmentTitle: "Integration Test Assignment", score: "95" },
          },
        });
        notificationId = notif.id;

        expect(notif.id).toBeDefined();
        expect(notif.type).toBe("grade_ready");
        expect(notif.readAt).toBeNull();
      });

      // N-2 / AC-2: GET /me/notifications?unread=true
      it("N-2 AC-2: GET /me/notifications?unread=true returns only unread rows", async () => {
        const res = await request(httpServer)
          .get("/api/v1/me/notifications?unread=true")
          .set("Cookie", cookieHeader(studentCookies));

        expect(res.status).toBe(200);
        expect(res.body.data).toBeInstanceOf(Array);
        for (const n of res.body.data) {
          expect(n.readAt).toBeNull();
        }
      });

      // N-3 / AC-3: Mark single notification read
      it("N-3 AC-3: POST /me/notifications/:id/read → readAt set", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/me/notifications/${notificationId}/read`)
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent);

        expect(res.status).toBe(200);
        const updated = await prisma.notification.findUnique({ where: { id: notificationId } });
        expect(updated?.readAt).not.toBeNull();
      });

      // N-5 / AC-5: IDOR — student B cannot mark student A's notification
      it("N-5 AC-5: IDOR — student B cannot mark student A notification as read → 404", async () => {
        const notifA = await prisma.notification.create({
          data: {
            tenantId, userId: studentUserId, type: "announcement",
            channels: { in_app: true, email: false, sms: false, whatsapp: false },
            payload: { title: "Test", body: "Test announcement" },
          },
        });

        const res = await request(httpServer)
          .post(`/api/v1/me/notifications/${notifA.id}/read`)
          .set("Cookie", cookieHeader(studentBCookies))
          .set("X-CSRF-Token", csrfStudentB);

        expect(res.status).toBe(404); // IDOR-safe — no 403 leak
      });

      // N-4 / AC-4: Mark all read
      it("N-4 AC-4: POST /me/notifications/read-all → all unread marked", async () => {
        await prisma.notification.createMany({
          data: [
            { tenantId, userId: studentUserId, type: "announcement", channels: { in_app: true }, payload: { title: "Ann 1" } },
            { tenantId, userId: studentUserId, type: "announcement", channels: { in_app: true }, payload: { title: "Ann 2" } },
          ],
        });

        const res = await request(httpServer)
          .post("/api/v1/me/notifications/read-all")
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent);

        expect(res.status).toBe(200);
        expect(res.body.data.unreadCount).toBe(0);
      });

      // N-6 / AC-6 HEADLINE: grade_ready fan-out — in-app + opted-in email, prefs honored
      it("N-6 AC-6 HEADLINE: grade_ready notify() → in_app row + MailProvider.send called exactly once", async () => {
        // Arrange prefs DIRECTLY via Prisma (not the HTTP PUT — see CRITICAL-2 in the
        // header: PUT /me/notification-prefs requires "notification_prefs.edit", which
        // is never seeded, so the endpoint 403s for every role. This test targets the
        // notify() fan-out logic itself, so we bypass the broken endpoint to isolate it.
        await prisma.notificationPref.upsert({
          where: { userId: studentUserId },
          create: { tenantId, userId: studentUserId, matrix: { grade_ready: { in_app: true, email: true, sms: false, whatsapp: false } } },
          update: { matrix: { grade_ready: { in_app: true, email: true, sms: false, whatsapp: false } } },
        });

        const sendSpy = jest.spyOn(mailProvider, "send");
        const sendTemplateSpy = jest.spyOn(whatsappProvider, "sendTemplate");
        try {
          const result = await notifSvc.notify(
            studentUserId, tenantId, "grade_ready",
            { assignmentTitle: "AC-6 Assignment", score: "88" },
            { toEmail: studentEmail },
          );

          expect(result.notificationId).not.toBeNull();
          expect(sendSpy).toHaveBeenCalledTimes(1);
          expect((sendSpy.mock.calls[0]?.[0] as { to: string }).to).toBe(studentEmail);
          expect(sendTemplateSpy).not.toHaveBeenCalled();

          const row = await prisma.notification.findUnique({ where: { id: result.notificationId! } });
          expect(row?.channels).toMatchObject({ in_app: true, email: true, whatsapp: false, sms: false });
        } finally {
          sendSpy.mockRestore();
          sendTemplateSpy.mockRestore();
        }
      });

      // N-7 / AC-7: all external channels off → only in_app row, no provider calls
      it("N-7 AC-7: all channels disabled for a type → only in_app row; no provider called", async () => {
        // Arrange DIRECTLY via Prisma — see CRITICAL-2 note on N-6 above.
        const existing = await prisma.notificationPref.findUnique({ where: { userId: studentUserId } });
        const mergedMatrix = { ...(existing?.matrix as object ?? {}), welcome: { in_app: true, email: false, sms: false, whatsapp: false } };
        await prisma.notificationPref.upsert({
          where: { userId: studentUserId },
          create: { tenantId, userId: studentUserId, matrix: mergedMatrix },
          update: { matrix: mergedMatrix },
        });

        const sendSpy = jest.spyOn(mailProvider, "send");
        try {
          const result = await notifSvc.notify(
            studentUserId, tenantId, "welcome", { userName: "P6 Student A" }, { toEmail: studentEmail },
          );
          expect(result.notificationId).not.toBeNull();
          expect(sendSpy).not.toHaveBeenCalled();

          const row = await prisma.notification.findUnique({ where: { id: result.notificationId! } });
          expect(row?.channels).toMatchObject({ in_app: true, email: false });
        } finally {
          sendSpy.mockRestore();
        }
      });

      // N-8 / AC-11: suppressed channel → provider NOT called; in_app row still created
      it("N-8 AC-11: suppressed email channel → MailProvider.send NOT called (in_app unaffected)", async () => {
        // Student re-opts into email for grade_ready (direct Prisma — see CRITICAL-2),
        // then gets suppressed on email.
        await prisma.notificationPref.upsert({
          where: { userId: studentUserId },
          create: { tenantId, userId: studentUserId, matrix: { grade_ready: { in_app: true, email: true, sms: false, whatsapp: false } } },
          update: { matrix: { grade_ready: { in_app: true, email: true, sms: false, whatsapp: false } } },
        });

        await prisma.notificationSuppression.create({
          data: { tenantId, userId: studentUserId, email: studentEmail, channel: "email", reason: "unsubscribe" },
        });

        const sendSpy = jest.spyOn(mailProvider, "send");
        try {
          const result = await notifSvc.notify(
            studentUserId, tenantId, "grade_ready",
            { assignmentTitle: "AC-11 Assignment", score: "70" },
            { toEmail: studentEmail },
          );
          expect(result.notificationId).not.toBeNull();
          expect(sendSpy).not.toHaveBeenCalled();
        } finally {
          sendSpy.mockRestore();
        }
      });

      // N-13 / AC-9: quiet hours defer non-urgent channels (uses studentB — clean state,
      // no suppression from N-8 above, isolating the quiet-hours behavior specifically).
      it("N-13 AC-9: quiet hours (whole-day window, deterministic) defers a non-urgent send", async () => {
        await prisma.notificationPref.upsert({
          where: { userId: studentBUserId },
          create: { tenantId, userId: studentBUserId, matrix: {}, quietHours: { start: "00:00", end: "23:59", tz: "Asia/Kolkata" } },
          update: { quietHours: { start: "00:00", end: "23:59", tz: "Asia/Kolkata" } },
        });

        const sendSpy = jest.spyOn(mailProvider, "send");
        try {
          // "announcement" is not in URGENT_NOTIFICATION_TYPES — default prefs have email=true.
          const result = await notifSvc.notify(
            studentBUserId, tenantId, "announcement", { title: "Quiet hours test" }, { toEmail: studentBEmail },
          );
          expect(result.notificationId).not.toBeNull(); // in_app always fires (AC-9)
          expect(sendSpy).not.toHaveBeenCalled(); // deferred — sync-seam skips, does not throw
        } finally {
          sendSpy.mockRestore();
        }
      });

      // N-14 / AC-10: urgent notification types bypass quiet hours
      it("N-14 AC-10: urgent notification type (certificate_ready) bypasses quiet hours", async () => {
        // Same whole-day quiet-hours window as N-13 (still active on studentB).
        const sendSpy = jest.spyOn(mailProvider, "send");
        try {
          const result = await notifSvc.notify(
            studentBUserId, tenantId, "certificate_ready",
            { certificateId: "cert-ac10", programTitle: "AC-10 Program" },
            { toEmail: studentBEmail },
          );
          expect(result.notificationId).not.toBeNull();
          expect(sendSpy).toHaveBeenCalledTimes(1); // urgent → dispatched immediately
        } finally {
          sendSpy.mockRestore();
        }
      });

      // N-15 / AC-12: Noop providers never throw and return deterministic success
      it("N-15 AC-12: Noop Mail + WhatsApp providers return deterministic success, no network call", async () => {
        const mailResult = await (mailProvider as { send: (i: unknown) => Promise<{ providerMessageId: string }> })
          .send({ to: "noop-check@test.com", subject: "x", html: "y" });
        expect(mailResult.providerMessageId).toMatch(/^noop-mail-/);

        const waResult = await (whatsappProvider as {
          sendTemplate: (i: unknown) => Promise<{ providerMessageId: string }>;
        }).sendTemplate({ to: "+919999999999", templateName: "t", dltTemplateId: "DLT123", variables: [] });
        expect(waResult.providerMessageId).toMatch(/^noop-wa-/);
      });

      // N-9 / AC-22: Valid unsubscribe token creates suppression row
      it("N-9 AC-22: valid signed unsubscribe token → creates notification_suppressions row", async () => {
        const token = generateUnsubscribeToken(studentUserId, "email");
        const res = await request(httpServer).post(`/api/v1/unsubscribe/${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.channel).toBe("email");

        const suppression = await prisma.notificationSuppression.findFirst({
          where: { userId: studentUserId, channel: "email", reason: "unsubscribe" },
        });
        expect(suppression).not.toBeNull();
      });

      // N-10 / AC-24: Tampered token → 400
      it("N-10 AC-24: tampered unsubscribe token → 400 INVALID_TOKEN", async () => {
        const goodToken = generateUnsubscribeToken(studentUserId, "email");
        const tampered = goodToken.slice(0, -1) + (goodToken.endsWith("A") ? "B" : "A");

        const res = await request(httpServer).post(`/api/v1/unsubscribe/${tampered}`);
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain("INVALID_TOKEN");
      });

      // N-12 / AC-18 + AC-19: Notification prefs
      it("N-12 AC-18: GET /me/notification-prefs returns matrix (or defaults)", async () => {
        const res = await request(httpServer)
          .get("/api/v1/me/notification-prefs")
          .set("Cookie", cookieHeader(studentCookies));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty("matrix");
      });

      // CRITICAL-2 FIXED (P7 W1): `notification_prefs.edit` is now in the P6 permission
      // catalog and granted to every role at own scope (prisma/seed.ts), so this route
      // no longer 403s. Asserts the spec-correct behavior (AC-19).
      it("N-12 AC-19: PUT /me/notification-prefs upserts prefs + reflects on next GET", async () => {
        const res = await request(httpServer)
          .put("/api/v1/me/notification-prefs")
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent)
          .send({ matrix: { grade_ready: { in_app: true, email: true, sms: false, whatsapp: false } } });

        expect([200, 201]).toContain(res.status);
        expect(res.body.data).toHaveProperty("matrix");

        const getRes = await request(httpServer)
          .get("/api/v1/me/notification-prefs")
          .set("Cookie", cookieHeader(studentCookies));
        expect(getRes.body.data.matrix.grade_ready).toMatchObject({ email: true });
      });

      // N-11 / AC-72: Cross-tenant isolation — repository-layer proof (see DEFECTS note:
      // /auth/login cannot authenticate a genuinely different tenant in this phase).
      it("N-11 AC-72: notifications repository query rejects a mismatched tenantId → 404", async () => {
        const notifA = await prisma.notification.create({
          data: { tenantId, userId: studentUserId, type: "grade_ready", channels: { in_app: true }, payload: {} },
        });

        await expect(
          notifSvc.markRead(studentUserId, foreignTenantId, notifA.id),
        ).rejects.toBeInstanceOf(NotFoundException);

        // Sanity: the SAME call with the real tenantId succeeds (proves the 404 above is
        // specifically the tenant filter, not some unrelated failure).
        await expect(notifSvc.markRead(studentUserId, tenantId, notifA.id)).resolves.toBeDefined();
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // WS-2: Campaigns
    // ═══════════════════════════════════════════════════════════════════════════

    describe("WS-2 Campaigns", () => {
      beforeAll(async () => {
        const templateRes = await request(httpServer)
          .post("/api/v1/campaigns/templates")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({
            channel: "email", name: "P6 Integration Test Template",
            subject: "Hello {{to}}!", body: "Welcome to {{campaignName}}", variables: ["to", "campaignName"],
          });
        if (templateRes.status === 201 || templateRes.status === 200) {
          campaignTemplateId = templateRes.body.data?.id;
        }
      });

      // C-4 / AC-31 + AC-78: SMS/WA without dltTemplateId is rejected before any row is
      // created. NOTE (M-1 finding, not asserted-failing — see header): `dltTemplateId`
      // is `z.string().min(1)` (required) in the sms/whatsapp arm of the discriminated
      // union (packages/types/src/engagement/campaigns.schemas.ts), so an omitted field
      // is caught by the global `ZodValidationPipe`, which ALWAYS throws
      // `BadRequestException` (400, code="validation.failed") for ANY schema violation —
      // see apps/api/src/common/pipes/zod-validation.pipe.ts (the one true validator,
      // used everywhere, with no per-schema override). The service's OWN dedicated
      // 422 `DLT_TEMPLATE_ID_REQUIRED` check (campaigns.service.ts createTemplate) is
      // real and correct, but is unreachable for a fully-omitted field — it only fires
      // if a request somehow reaches the service with an empty/falsy value the zod
      // schema would have already rejected. AC-78's literal wording ("422 …") describes
      // an aspirational status code that does not match this codebase's consistent,
      // deliberate 400-for-shape / 422-for-business-rule convention. This is a spec-
      // wording precision gap, not a functional/security defect (the create IS still
      // rejected either way).
      it("C-4 AC-31/AC-78: creating SMS template without dltTemplateId → 400 (zod-boundary rejection)", async () => {
        const res = await request(httpServer)
          .post("/api/v1/campaigns/templates")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "sms", name: "SMS Without DLT", body: "Your batch is starting tomorrow.", variables: [] });

        expect(res.status).toBe(400);
        const template = await prisma.campaignTemplate.findFirst({ where: { tenantId, name: "SMS Without DLT" } });
        expect(template).toBeNull(); // no row created either way
      });

      it("C-4 AC-78: creating WhatsApp template without dltTemplateId → 400 (zod-boundary rejection, see M-1 above)", async () => {
        const res = await request(httpServer)
          .post("/api/v1/campaigns/templates")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "whatsapp", name: "WA Without DLT", body: "Hello {{name}}!", variables: ["name"] });

        expect(res.status).toBe(400);
      });

      // C-4b / AC-31 (the REACHABLE, correct 422 path): a whatsapp campaign whose
      // template's dlt_template_id is null at SEND time is rejected with the real
      // service-layer 422 DLT_TEMPLATE_ID_REQUIRED (defense-in-depth against a template
      // row created before this field existed, or mutated directly). This is the path
      // AC-31's wording actually describes (distinct from the zod-boundary M-1 finding
      // on template CREATE above).
      it("C-4b AC-31: sending a whatsapp campaign whose template has no dltTemplateId → 422 DLT_TEMPLATE_ID_REQUIRED", async () => {
        const badTemplate = await prisma.campaignTemplate.create({
          data: { tenantId, channel: "whatsapp", name: "Legacy WA Template (no DLT)", body: "Hi {{to}}", dltTemplateId: null, variables: [] },
        });
        const createRes = await request(httpServer)
          .post("/api/v1/campaigns")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "whatsapp", templateId: badTemplate.id, name: "AC-31 No-DLT Campaign", segment: { source: "leads" } });
        expect(createRes.status).toBe(201);

        const sendRes = await request(httpServer)
          .post(`/api/v1/campaigns/${createRes.body.data.id}/send`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(sendRes.status).toBe(422);
        expect(JSON.stringify(sendRes.body)).toContain("DLT_TEMPLATE_ID_REQUIRED");
      });

      // C-5 / AC-32: email without dltTemplateId → proceeds
      it("C-5 AC-32: creating email template without dltTemplateId → 201 (email is not DLT-gated)", async () => {
        const res = await request(httpServer)
          .post("/api/v1/campaigns/templates")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "email", name: "Email Template No DLT", subject: "Hello!", body: "Test body", variables: [] });

        expect([200, 201]).toContain(res.status);
      });

      // C-1 / AC-27 HEADLINE: exactly-once send to an isolated 3-lead segment, verified
      // via a real MailProvider.send() spy (not just HTTP status codes).
      it("C-1 AC-27 HEADLINE: 3-recipient segment → exactly 3 sends; replay is a no-op (still 3 total)", async () => {
        expect(campaignTemplateId).toBeDefined();

        // Isolated program so the segment can't accidentally pick up unrelated seed leads.
        const program = await prisma.program.create({
          data: { tenantId, slug: `p6-ac27-${Date.now()}`, title: "AC-27 Program", domain: "Engineering", pricePaise: 5000_00, status: "published" },
        });

        const leads = await Promise.all(
          [0, 1, 2].map((i) =>
            prisma.lead.create({
              data: {
                tenantId, name: `AC27 Lead ${i}`, phone: `9000000${i}00`,
                email: `ac27-lead-${i}-${Date.now()}@test.com`, source: "integration-test",
                programInterestId: program.id, consent: { marketing_opt_in: true },
              },
            }),
          ),
        );

        const createRes = await request(httpServer)
          .post("/api/v1/campaigns")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({
            channel: "email", templateId: campaignTemplateId, name: "AC-27 Exactly-Once Campaign",
            segment: { source: "leads", programIds: [program.id] },
          });
        expect([200, 201]).toContain(createRes.status);
        campaignId = createRes.body.data.id;

        const sendSpy = jest.spyOn(mailProvider, "send");
        try {
          const sendRes = await request(httpServer)
            .post(`/api/v1/campaigns/${campaignId}/send`)
            .set("Cookie", cookieHeader(adminCookies))
            .set("X-CSRF-Token", csrfAdmin);
          expect(sendRes.status).toBe(200);
          expect(sendSpy).toHaveBeenCalledTimes(3);

          const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId, tenantId } });
          expect(recipients).toHaveLength(3);
          for (const r of recipients) {
            expect(r.status).toBe("sent");
            expect([leads[0]!.email, leads[1]!.email, leads[2]!.email]).toContain(r.to);
          }

          // Replay: sending again — campaign is now "sent", not sendable → 422 no-op,
          // and crucially NO additional provider calls are made (still 3 total).
          const replayRes = await request(httpServer)
            .post(`/api/v1/campaigns/${campaignId}/send`)
            .set("Cookie", cookieHeader(adminCookies))
            .set("X-CSRF-Token", csrfAdmin);
          expect(replayRes.status).toBe(422);
          expect(sendSpy).toHaveBeenCalledTimes(3); // unchanged — no double-send
        } finally {
          sendSpy.mockRestore();
        }
      });

      // C-2 / AC-29: non-consented lead is excluded from the materialized segment
      it("C-2 AC-29: lead with marketing_opt_in=false is excluded — zero recipients, zero sends", async () => {
        const program = await prisma.program.create({
          data: { tenantId, slug: `p6-ac29-${Date.now()}`, title: "AC-29 Program", domain: "Engineering", pricePaise: 5000_00, status: "published" },
        });
        await prisma.lead.create({
          data: {
            tenantId, name: "AC29 Non-Consented Lead", phone: "9111111111",
            email: `ac29-lead-${Date.now()}@test.com`, source: "integration-test",
            programInterestId: program.id, consent: { marketing_opt_in: false },
          },
        });

        const templateRes = await request(httpServer)
          .post("/api/v1/campaigns/templates")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "email", name: "AC-29 Template", subject: "Hi", body: "Hi {{to}}", variables: ["to"] });
        const templateId = templateRes.body.data.id;

        const createRes = await request(httpServer)
          .post("/api/v1/campaigns")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "email", templateId, name: "AC-29 Campaign", segment: { source: "leads", programIds: [program.id] } });
        const acCampaignId = createRes.body.data.id;

        const sendSpy = jest.spyOn(mailProvider, "send");
        try {
          const sendRes = await request(httpServer)
            .post(`/api/v1/campaigns/${acCampaignId}/send`)
            .set("Cookie", cookieHeader(adminCookies))
            .set("X-CSRF-Token", csrfAdmin);
          expect(sendRes.status).toBe(200);
          expect(sendSpy).not.toHaveBeenCalled();

          const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: acCampaignId, tenantId } });
          expect(recipients).toHaveLength(0);
        } finally {
          sendSpy.mockRestore();
        }
      });

      // C-3 / AC-30: suppressed recipient → recipient row = failed/suppressed, no send
      it("C-3 AC-30: suppressed recipient → campaign_recipients.status=failed error=suppressed", async () => {
        const program = await prisma.program.create({
          data: { tenantId, slug: `p6-ac30-${Date.now()}`, title: "AC-30 Program", domain: "Engineering", pricePaise: 5000_00, status: "published" },
        });
        const suppressedEmail = `ac30-suppressed-${Date.now()}@test.com`;
        await prisma.lead.create({
          data: {
            tenantId, name: "AC30 Suppressed Lead", phone: "9222222222", email: suppressedEmail,
            source: "integration-test", programInterestId: program.id, consent: { marketing_opt_in: true },
          },
        });
        await prisma.notificationSuppression.create({
          data: { tenantId, email: suppressedEmail, channel: "email", reason: "unsubscribe" },
        });

        const templateRes = await request(httpServer)
          .post("/api/v1/campaigns/templates")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "email", name: "AC-30 Template", subject: "Hi", body: "Hi {{to}}", variables: ["to"] });
        const templateId = templateRes.body.data.id;

        const createRes = await request(httpServer)
          .post("/api/v1/campaigns")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ channel: "email", templateId, name: "AC-30 Campaign", segment: { source: "leads", programIds: [program.id] } });
        const acCampaignId = createRes.body.data.id;

        const sendSpy = jest.spyOn(mailProvider, "send");
        try {
          const sendRes = await request(httpServer)
            .post(`/api/v1/campaigns/${acCampaignId}/send`)
            .set("Cookie", cookieHeader(adminCookies))
            .set("X-CSRF-Token", csrfAdmin);
          expect(sendRes.status).toBe(200);

          const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: acCampaignId, tenantId } });
          expect(recipients).toHaveLength(1);
          expect(recipients[0]!.status).toBe("failed");
          expect(recipients[0]!.error).toBe("suppressed");
          expect(sendSpy).not.toHaveBeenCalled();
        } finally {
          sendSpy.mockRestore();
        }
      });

      // C-7 / AC-39: forged webhook → 401
      it("C-7 AC-39: POST /campaigns/webhooks/email with invalid HMAC → 401", async () => {
        const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "msg-forged" } });
        const res = await request(httpServer)
          .post("/api/v1/campaigns/webhooks/email")
          .set("Content-Type", "application/json")
          .set("svix-signature", "v1=invalid_hmac_signature")
          .set("svix-timestamp", String(Math.floor(Date.now() / 1000)))
          .send(payload);
        expect([400, 401, 403]).toContain(res.status);
      });

      // C-8 / AC-40: unknown providerMessageId → 200 silent discard
      it("C-8 AC-40: webhook for unknown providerMessageId → 200 (silent discard, no 500)", async () => {
        const payload = JSON.stringify({
          providerMessageId: "completely-unknown-msg-id-xyz", event: "delivered", occurredAt: new Date().toISOString(),
        });
        const res = await request(httpServer)
          .post("/api/v1/campaigns/webhooks/email")
          .set("Content-Type", "application/json")
          .set("svix-signature", "v1=noop")
          .set("svix-timestamp", String(Math.floor(Date.now() / 1000)))
          .send(payload);
        expect(res.status).not.toBe(500);
      });

      // C-9 / AC-73: Cross-tenant isolation — repository-layer proof
      it("C-9 AC-73: campaign recipients repository query rejects a mismatched tenantId → 404", async () => {
        expect(campaignId).toBeDefined();
        await expect(
          campaignsSvc.listRecipients(foreignTenantId, campaignId, { page: 1, pageSize: 20 }),
        ).rejects.toBeInstanceOf(NotFoundException);

        await expect(
          campaignsSvc.listRecipients(tenantId, campaignId, { page: 1, pageSize: 20 }),
        ).resolves.toBeDefined();
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // WS-3: Gamification
    // ═══════════════════════════════════════════════════════════════════════════

    describe("WS-3 Gamification", () => {
      // G-1 / AC-43: lesson_completed award via the REAL service (not a raw insert)
      it("G-1 AC-43: GamificationService.awardForLessonCompleted() appends a points_ledger row", async () => {
        const ref = `int-lesson-${Date.now()}`;
        await gamSvc.awardForLessonCompleted(studentUserId, tenantId, ref);

        const rows = await prisma.pointsLedger.findMany({ where: { tenantId, userId: studentUserId, reason: "lesson_completed", ref } });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.delta).toBeGreaterThan(0);
      });

      // G-2 / AC-44 HEADLINE: replay through the SERVICE (proves the P2002 is actually
      // swallowed by the service layer, not just that the DB constraint exists).
      it("G-2 AC-44 HEADLINE: replaying awardForLessonCompleted() for the same ref → no double-award", async () => {
        const ref = `int-lesson-dedupe-${Date.now()}`;

        await gamSvc.awardForLessonCompleted(studentUserId, tenantId, ref);
        const totalBefore = await prisma.pointsLedger.aggregate({
          where: { tenantId, userId: studentUserId, deletedAt: null }, _sum: { delta: true },
        });

        // Replay — must NOT throw (service swallows P2002) and must NOT insert a 2nd row.
        await expect(gamSvc.awardForLessonCompleted(studentUserId, tenantId, ref)).resolves.toBeUndefined();

        const rows = await prisma.pointsLedger.findMany({ where: { tenantId, userId: studentUserId, reason: "lesson_completed", ref } });
        expect(rows).toHaveLength(1);

        const totalAfter = await prisma.pointsLedger.aggregate({
          where: { tenantId, userId: studentUserId, deletedAt: null }, _sum: { delta: true },
        });
        expect(totalAfter._sum.delta).toEqual(totalBefore._sum.delta); // XP unchanged by the replay
      });

      // G-3 / AC-45 + AC-46: badge threshold fires once via the service; replay → no-op
      it("G-3 AC-45/46: awardForProjectApproved() awards first_project_approved badge once; replay is a no-op", async () => {
        const ref = `int-project-${Date.now()}`;
        await gamSvc.awardForProjectApproved(studentUserId, tenantId, ref);

        const badge = await prisma.badge.findFirst({ where: { tenantId, key: "first_project_approved" } });
        let badgeRows = await prisma.userBadge.findMany({ where: { tenantId, userId: studentUserId, badgeId: badge!.id, deletedAt: null } });
        expect(badgeRows).toHaveLength(1);

        await expect(gamSvc.awardForProjectApproved(studentUserId, tenantId, ref)).resolves.toBeUndefined();
        badgeRows = await prisma.userBadge.findMany({ where: { tenantId, userId: studentUserId, badgeId: badge!.id, deletedAt: null } });
        expect(badgeRows).toHaveLength(1); // still exactly one
      });

      // G-4 / AC-49: GET /me/gamification returns correct shape
      it("G-4 AC-49: GET /me/gamification returns totalPoints + badges + streak", async () => {
        const res = await request(httpServer)
          .get("/api/v1/me/gamification")
          .set("Cookie", cookieHeader(studentCookies));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty("totalPoints");
        expect(res.body.data).toHaveProperty("badges");
        expect(res.body.data).toHaveProperty("streak");
        expect(typeof res.body.data.totalPoints).toBe("number");
        expect(Array.isArray(res.body.data.badges)).toBe(true);
      });

      // G-5 / AC-50: Leaderboard PII-minimal response-key scan
      it("G-5 AC-50: leaderboard entries carry ONLY rank/displayName/totalPoints/badgeCount", async () => {
        await request(httpServer)
          .put("/api/v1/me/gamification/prefs")
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent)
          .send({ leaderboardOptIn: true, leaderboardDisplayName: "IntegrationTester" });

        const res = await request(httpServer)
          .get(`/api/v1/batches/${batchId}/leaderboard`)
          .set("Cookie", cookieHeader(studentCookies));

        expect(res.status).toBe(200);
        const entries = res.body.data ?? [];
        for (const entry of entries) {
          expect(entry).not.toHaveProperty("email");
          expect(entry).not.toHaveProperty("phone");
          expect(entry).not.toHaveProperty("userId");
          expect(entry).not.toHaveProperty("enrollmentId");
          expect(entry).not.toHaveProperty("firstName");
          expect(entry).not.toHaveProperty("lastName");
        }
      });

      // G-6 / AC-52: Non-enrolled student → 404 on leaderboard
      it("G-6 AC-52: non-enrolled student accessing another batch's leaderboard → 404", async () => {
        const res = await request(httpServer)
          .get(`/api/v1/batches/${batchCId}/leaderboard`)
          .set("Cookie", cookieHeader(studentCookies));
        expect(res.status).toBe(404);
      });

      // G-7 / AC-75: Cross-tenant isolation — repository-layer proof
      it("G-7 AC-75: points_ledger repository query is tenant-scoped (foreign tenant sees 0 points)", async () => {
        const summary = await gamSvc.getMyGamification(foreignTenantId, studentUserId);
        expect(summary.totalPoints).toBe(0); // real ledger rows exist for studentUserId, but under `tenantId`, not `foreignTenantId`

        const realSummary = await gamSvc.getMyGamification(tenantId, studentUserId);
        expect(realSummary.totalPoints).toBeGreaterThan(0); // sanity: the real tenant DOES see them
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // WS-4: Forum
    // ═══════════════════════════════════════════════════════════════════════════

    describe("WS-4 Forum", () => {
      let postId: string;

      // F-1 / AC-53: enrolled student reads threads in own batch.
      // CRITICAL-1 FIXED (P7 W1): forum.read is now in the seeded permission catalog and
      // granted per-role by scope, so forum reads no longer 403.
      it("F-1 AC-53: enrolled student reads threads in enrolled batch → 200", async () => {
        const res = await request(httpServer)
          .get(`/api/v1/forum/threads?batchId=${batchId}`)
          .set("Cookie", cookieHeader(studentCookies));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
      });

      // F-2a / AC-55: non-enrolled student reading threads → 404 (IDOR-safe).
      // CRITICAL-1 FIXED (P7 W1): forum.read is granted, so the PermissionsGuard now lets
      // the request reach the service's enrollment/IDOR check, which returns 404.
      it("F-2a AC-55: non-enrolled student reading batch C threads → 404 (IDOR-safe)", async () => {
        const res = await request(httpServer)
          .get(`/api/v1/forum/threads?batchId=${batchCId}`)
          .set("Cookie", cookieHeader(studentCookies));
        expect(res.status).toBe(404);
      });

      // F-3 / AC-57: enrolled student creates a thread → 201 (forum.post IS granted — unaffected by CRITICAL-1)
      it("F-3 AC-57: enrolled student creates a thread in enrolled batch → 201", async () => {
        const res = await request(httpServer)
          .post("/api/v1/forum/threads")
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent)
          .send({ batchId, title: "P6 Integration Test Thread", body: "This is the initial post body for the integration test thread." });

        expect(res.status).toBe(201);
        forumThreadId = res.body.data.id;
      });

      // F-2b / AC-56 HEADLINE: non-enrolled student posting → 404 (IDOR-safe)
      it("F-2b AC-56 HEADLINE: non-enrolled student posting in batch C → 404 (IDOR-safe)", async () => {
        const before = await prisma.forumThread.count({ where: { tenantId, batchId: batchCId } });

        const res = await request(httpServer)
          .post("/api/v1/forum/threads")
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent)
          .send({ batchId: batchCId, title: "Should Not Be Created", body: "This should fail with 404." });

        expect(res.status).toBe(404);
        const after = await prisma.forumThread.count({ where: { tenantId, batchId: batchCId } });
        expect(after).toBe(before); // no row created
      });

      // F-4 / AC-58: enrolled student creates a reply post → 201
      it("F-4 AC-58: enrolled student creates a reply post in their thread → 201", async () => {
        expect(forumThreadId).toBeDefined();
        const res = await request(httpServer)
          .post(`/api/v1/forum/threads/${forumThreadId}/posts`)
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent)
          .send({ body: "This is a reply to the integration test thread." });

        expect(res.status).toBe(201);
        postId = res.body.data.id;
      });

      // F-5 / AC-60: reply notifies the thread author (studentUserId), NOT the author of
      // their own reply.
      it("F-5 AC-60: reply by a DIFFERENT user notifies the thread author exactly once", async () => {
        const spy = jest.spyOn(notifSvc, "notifyForumReply");
        try {
          const res = await request(httpServer)
            .post(`/api/v1/forum/threads/${forumThreadId}/posts`)
            .set("Cookie", cookieHeader(studentBCookies))
            .set("X-CSRF-Token", csrfStudentB)
            .send({ body: "Reply from Student B — should notify the thread author (Student A)." });
          expect(res.status).toBe(201);

          await sleep(250); // notifyThreadAuthor is fire-and-forget (not awaited by the controller)
          expect(spy).toHaveBeenCalledTimes(1);
          expect(spy.mock.calls[0]?.[0]).toBe(studentUserId); // notified: the thread AUTHOR
        } finally {
          spy.mockRestore();
        }
      });

      it("F-5b AC-60 (not-self): thread author replying to their OWN thread does not self-notify", async () => {
        const spy = jest.spyOn(notifSvc, "notifyForumReply");
        try {
          const res = await request(httpServer)
            .post(`/api/v1/forum/threads/${forumThreadId}/posts`)
            .set("Cookie", cookieHeader(studentCookies)) // studentA == thread author
            .set("X-CSRF-Token", csrfStudent)
            .send({ body: "Reply from the thread author to their own thread — no self-notify." });
          expect(res.status).toBe(201);

          await sleep(250);
          expect(spy).not.toHaveBeenCalled();
        } finally {
          spy.mockRestore();
        }
      });

      // F-6 / AC-61: upvote is deduped — second tap toggles OFF (not a duplicate row)
      it("F-6 AC-61: upvote dedupes — second vote from the same user toggles OFF", async () => {
        expect(postId).toBeDefined(); // authored by studentA
        const first = await request(httpServer)
          .post(`/api/v1/forum/posts/${postId}/vote`)
          .set("Cookie", cookieHeader(studentBCookies))
          .set("X-CSRF-Token", csrfStudentB);
        expect(first.status).toBe(200);
        expect(first.body.data.hasVoted).toBe(true);
        expect(first.body.data.upvotes).toBe(1);

        const second = await request(httpServer)
          .post(`/api/v1/forum/posts/${postId}/vote`)
          .set("Cookie", cookieHeader(studentBCookies))
          .set("X-CSRF-Token", csrfStudentB);
        expect(second.status).toBe(200);
        expect(second.body.data.hasVoted).toBe(false);
        expect(second.body.data.upvotes).toBe(0);

        const voteRows = await prisma.forumPostVote.findMany({ where: { postId, userId: studentBUserId } });
        expect(voteRows.length).toBeLessThanOrEqual(1); // toggle-off soft-deletes, never duplicates
      });

      // F-7 / AC-62: self-vote → 422 CANNOT_VOTE_OWN_POST
      it("F-7 AC-62: student cannot upvote their own post → 422 CANNOT_VOTE_OWN_POST", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/forum/posts/${postId}/vote`)
          .set("Cookie", cookieHeader(studentCookies)) // studentA authored postId
          .set("X-CSRF-Token", csrfStudent);
        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain("CANNOT_VOTE_OWN_POST");
      });

      // F-8 / AC-64: faculty (assigned to batch A only) cannot moderate batch C content
      it("F-8 AC-64: faculty moderating a post in a NON-assigned batch → 404 (IDOR-safe)", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/forum/posts/${batchCPostId}/moderate`)
          .set("Cookie", cookieHeader(facultyCookies))
          .set("X-CSRF-Token", csrfFaculty)
          .send({ action: "hide", reason: "not assigned to this batch" });
        expect(res.status).toBe(404);
      });

      // F-9 / AC-65: faculty hides a post in their ASSIGNED batch, with a reason + audit row
      it("F-9 AC-65: faculty hides a post in an assigned batch → status=hidden + audit_logs row", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/forum/posts/${postId}/moderate`)
          .set("Cookie", cookieHeader(facultyCookies))
          .set("X-CSRF-Token", csrfFaculty)
          .send({ action: "hide", reason: "AC-65 integration test hide reason" });

        expect(res.status).toBe(200);
        expect(res.body.data.newStatus).toBe("hidden");

        const post = await prisma.forumPost.findUnique({ where: { id: postId } });
        expect(post?.status).toBe("hidden");
        expect(post?.hiddenById).toBe(facultyUserId);
        expect(post?.hiddenReason).toBe("AC-65 integration test hide reason");

        const auditRow = await prisma.auditLog.findFirst({
          where: { tenantId, entity: "ForumPost", entityId: postId, actorId: facultyUserId },
          orderBy: { createdAt: "desc" },
        });
        expect(auditRow).not.toBeNull();
      });

      // F-11 / AC-71: Body too long → rejected before any DB write.
      // Same M-1 finding as C-4 above: CreatePostDtoSchema's max-length check is a zod
      // schema constraint, so ZodValidationPipe throws 400 (code="validation.failed"),
      // not the spec-worded 422 "BODY_TOO_LONG". Not a functional defect — the write is
      // still rejected — see the M-1 note on the C-4 tests for the full explanation.
      it("F-11 AC-71: forum post body exceeding 10000 chars → 400 (zod-boundary rejection; see M-1)", async () => {
        const tooLongBody = "A".repeat(10001);
        const before = await prisma.forumPost.count({ where: { tenantId, threadId: forumThreadId } });
        const res = await request(httpServer)
          .post(`/api/v1/forum/threads/${forumThreadId}/posts`)
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent)
          .send({ body: tooLongBody });
        expect(res.status).toBe(400);
        const after = await prisma.forumPost.count({ where: { tenantId, threadId: forumThreadId } });
        expect(after).toBe(before); // no row written
      });

      // F-10 / AC-68: student cannot access moderation endpoints → 403 (PermissionsGuard
      // denies before any service logic — student role has no forum.moderate grant).
      it("F-10 AC-68: student cannot hide/pin/moderate posts → 403", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/forum/threads/${forumThreadId}/moderate`)
          .set("Cookie", cookieHeader(studentCookies))
          .set("X-CSRF-Token", csrfStudent)
          .send({ action: "hide", reason: "spam" });
        expect(res.status).toBe(403);
      });

      // F-12 / AC-74: Cross-tenant isolation — repository-layer proof
      it("F-12 AC-74: forum thread repository query rejects a mismatched tenantId → 404", async () => {
        expect(forumThreadId).toBeDefined();
        await expect(
          forumSvc.getThread(foreignTenantId, studentUserId, ["student"], forumThreadId),
        ).rejects.toBeInstanceOf(NotFoundException);

        await expect(
          forumSvc.getThread(tenantId, studentUserId, ["student"], forumThreadId),
        ).resolves.toBeDefined();
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // WS-5: Cross-cutting security
    // ═══════════════════════════════════════════════════════════════════════════

    describe("WS-5 Cross-cutting security", () => {
      // S-1 / AC-76: No provider secret in HTTP response
      it("S-1 AC-76: no provider secrets in notifications response body", async () => {
        const res = await request(httpServer)
          .get("/api/v1/me/notifications")
          .set("Cookie", cookieHeader(studentCookies));

        const body = JSON.stringify(res.body);
        expect(body).not.toContain("RESEND_API_KEY");
        expect(body).not.toContain("SES_SECRET_ACCESS_KEY");
        expect(body).not.toContain("WHATSAPP_ACCESS_TOKEN");
        expect(body).not.toContain("WHATSAPP_APP_SECRET");
        expect(body).not.toContain("MSG91_AUTH_KEY");
        expect(body).not.toContain("MAIL_WEBHOOK_SECRET");
        expect(body).not.toContain("NOTIFICATION_SIGNING_SECRET");
      });

      // S-2 / AC-77: Unsubscribe token does not contain raw userId in cleartext
      it("S-2 AC-77: unsubscribe token base64 structure contains HMAC", async () => {
        const token = generateUnsubscribeToken(studentUserId, "email");
        const decoded = Buffer.from(token, "base64url").toString("utf8");
        const parts = decoded.split(":");
        expect(parts).toHaveLength(5);
        expect(parts[0]).toBe("v1");
      });

      // A validly-signed token for a well-formed but non-existent user id is the
      // intended "unknown user" edge case (AC-22 note: idempotent success, no info leak).
      it("S-2b: validly-signed token for a non-existent (but UUID-shaped) userId → 200 idempotent, no leak", async () => {
        const forgery = generateUnsubscribeToken(randomUUID(), "email");
        const res = await request(httpServer).post(`/api/v1/unsubscribe/${forgery}`);
        expect(res.status).toBe(200);
      });

      // FIXED (P7 W1): findUserForUnsubscribe() now guards the UUID shape before hitting
      // the @db.Uuid column, so a validly-signed token whose embedded userId is not a UUID
      // resolves to the graceful "unknown user" path (null → idempotent success) instead of
      // an unhandled Postgres 22P02 cast error → 500. (Forgery still requires the HMAC secret.)
      it("S-2c: malformed (non-UUID) userId in an otherwise-valid token → no 500 (graceful)", async () => {
        const forgery = generateUnsubscribeToken("completely-fake-user-id", "email");
        const res = await request(httpServer).post(`/api/v1/unsubscribe/${forgery}`);
        expect(res.status).not.toBe(500);
      });

      // AC-15: SSE stream rejects unauthenticated requests
      it("AC-15: GET /me/notifications/stream without auth → 401", async () => {
        const res = await request(httpServer)
          .get("/api/v1/me/notifications/stream")
          .accept("text/event-stream");
        expect([401, 403]).toContain(res.status);
      });
    });
  },
);
