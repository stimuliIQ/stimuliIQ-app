// apps/api/test/integration/crm-batches-enrollments.integration-spec.ts
//
// P1 CRM-core integration coverage (qa-engineer, Wave 5, docs/plans/phase-1.md task #8)
// for batches + enrollments, run against REAL Postgres + Redis and the REAL Nest
// AppModule (no mocks).
//
// Acceptance-criteria coverage map:
//   1. CRUD happy-path (batches) + enroll/list/move/withdraw (enrollments)
//   3. ENROLLMENT HARD-RESTORE: re-enrolling into the same batch after a soft-deleted
//      row exists MUST restore (not duplicate, not violate the unique constraint)
//      -> "enrollment hard-restore" describe block
//   5. DATA-SCOPE ISOLATION: batches/enrollments branch+assigned scope is REAL (resolves
//      via direct branchId/facultyId columns / joins) -> "REAL scope isolation"
//   8. IDOR: GET/PATCH/DELETE on an out-of-scope batch id -> 404
//
// SKIPS GRACEFULLY when no Postgres/Redis could be resolved.

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
  process.env.COOKIE_SECRET = "integration-test-cookie-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.CSRF_SECRET = "integration-test-csrf-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";
  process.env.COOKIE_SECURE = "false";
  process.env.WEB_APP_URL = "http://localhost:3000";
  process.env.LMS_APP_URL = "http://localhost:3001";
  process.env.CRM_APP_URL = "http://localhost:3002";
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

describeIfAvailable("CRM batches + enrollments (CRUD, hard-restore, scope isolation, IDOR)", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const {
    seedCrmFixtures,
    teardownCrmFixtures,
    seedPaidOrder,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    BRANCH_MANAGER_EMAIL,
    BRANCH_MANAGER_PASSWORD,
    FACULTY_A_EMAIL,
    FACULTY_A_PASSWORD,
    FACULTY_B_EMAIL,
    FACULTY_B_PASSWORD,
  } = require("../fixtures/crm-fixtures");

  let app: import("@nestjs/common").INestApplication;
  let prisma: import("@prisma/client").PrismaClient;
  let fixtures: Awaited<ReturnType<typeof seedCrmFixtures>>;

  function extractCookie(res: import("supertest").Response, name: string): string | undefined {
    const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const match = list.find((c) => c.startsWith(`${name}=`));
    return match?.split(";")[0]?.split("=").slice(1).join("=");
  }

  async function loginAs(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password }).expect(200);
    return {
      res,
      accessToken: extractCookie(res, "access_token")!,
      csrfToken: extractCookie(res, "csrf_token")!,
    };
  }

  // CSRF double-submit (csrf.middleware.ts) requires BOTH the csrf_token cookie AND a
  // matching X-CSRF-Token header on every unsafe-method (POST/PUT/PATCH/DELETE) request
  // that already carries an access_token cookie. authHeaders() bundles all three.
  function authHeaders(accessToken: string, csrfToken: string): Record<string, string> {
    return {
      Cookie: `access_token=${accessToken}; csrf_token=${csrfToken}`,
      "X-CSRF-Token": csrfToken,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    fixtures = await seedCrmFixtures(prisma);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1", { exclude: ["health", "api-docs.json"] });
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await teardownCrmFixtures(prisma, fixtures.tenantId);
    await prisma?.$disconnect();
  });

  // ── 1. BATCHES: CRUD happy-path ────────────────────────────────────────────────────────

  describe("batches CRUD (super_admin, scope=all)", () => {
    let batchId: string;

    it("POST /crm/batches creates a batch", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/batches")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          programId: fixtures.programId,
          branchId: fixtures.branchAId,
          name: `QA CRUD Batch ${Date.now()}`,
          startDate: "2026-02-01",
          capacity: 5,
          mode: "hybrid",
          schedule: [],
          status: "planned",
        })
        .expect(201);
      batchId = res.body.data.id;
      expect(res.body.data.branchId).toBe(fixtures.branchAId);
    });

    it("GET, list/filter, PATCH, DELETE, restore round-trip", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .get(`/api/v1/crm/batches/${batchId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const list = await request(app.getHttpServer())
        .get("/api/v1/crm/batches")
        .query({ branchId: fixtures.branchAId, pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(list.body.data.some((b: { id: string }) => b.id === batchId)).toBe(true);

      await request(app.getHttpServer())
        .patch(`/api/v1/crm/batches/${batchId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ capacity: 8 })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/crm/batches/${batchId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const deleted = await prisma.batch.findUnique({ where: { id: batchId } });
      expect(deleted!.deletedAt).not.toBeNull();

      const restoreRes = await request(app.getHttpServer())
        .post(`/api/v1/crm/batches/${batchId}/restore`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(restoreRes.body.data.deletedAt).toBeNull();
    });

    it("audit-on-mutation: create + delete each write an audit_logs Batch row", async () => {
      const createAudit = await prisma.auditLog.findFirst({
        where: { entity: "Batch", entityId: batchId, action: "create" },
      });
      expect(createAudit).toBeTruthy();
      const deleteAudit = await prisma.auditLog.findFirst({
        where: { entity: "Batch", entityId: batchId, action: "delete" },
      });
      expect(deleteAudit).toBeTruthy();
    });
  });

  // ── 5. REAL scope isolation for batches (branch + assigned) ──────────────────────────

  describe("batches REAL scope isolation", () => {
    it("branch_manager (branch A) sees batch A, NOT batch B", async () => {
      const { accessToken, csrfToken } = await loginAs(BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/batches")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const ids = res.body.data.map((b: { id: string }) => b.id);
      expect(ids).toContain(fixtures.batchAId);
      expect(ids).not.toContain(fixtures.batchBId);
    });

    it("faculty A (scope=assigned) sees batch A (assigned to them), NOT batch B", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/batches")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const ids = res.body.data.map((b: { id: string }) => b.id);
      expect(ids).toContain(fixtures.batchAId);
      expect(ids).not.toContain(fixtures.batchBId);
    });

    it("faculty B (scope=assigned) sees batch B, NOT batch A", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_B_EMAIL, FACULTY_B_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/batches")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const ids = res.body.data.map((b: { id: string }) => b.id);
      expect(ids).toContain(fixtures.batchBId);
      expect(ids).not.toContain(fixtures.batchAId);
    });

    it("IDOR: faculty A GET on batch B's id returns 404 (not 403, not the row)", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/batches/${fixtures.batchBId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(404);
      expect(res.body.error.code).toBe("batches.not_found");
    });

    it("IDOR: faculty A PATCH on batch B's id returns 404, and the row is untouched", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/batches/${fixtures.batchBId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ capacity: 999 })
        .expect(404);

      const row = await prisma.batch.findUnique({ where: { id: fixtures.batchBId } });
      expect(row!.capacity).not.toBe(999);
    });
  });

  // ── 2/3. ENROLLMENTS: enroll/list/move/withdraw + hard-restore ───────────────────────

  describe("enrollments: enroll -> list -> move -> withdraw (super_admin, scope=all)", () => {
    let studentProfileId: string;
    let enrollmentId: string;

    beforeAll(async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const studentRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          name: "QA Enrollment Student",
          email: `qa-enroll-student-${Date.now()}@stimuliiq.test`,
          courseType: "btech",
          status: "active",
        })
        .expect(201);
      studentProfileId = studentRes.body.data.id;
      // Entitlement precondition: enroll() now requires a PAID order for the batch's program.
      await seedPaidOrder(prisma, { tenantId: fixtures.tenantId, studentId: studentProfileId, programId: fixtures.programId });
    });

    it("POST /crm/enrollments enrolls the student into batch A", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/enrollments")
        .set(authHeaders(accessToken, csrfToken))
        .send({ studentId: studentProfileId, batchId: fixtures.batchAId })
        .expect(201);
      enrollmentId = res.body.data.id;
      expect(res.body.data.status).toBe("active");
    });

    it("GET /crm/enrollments lists it", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/enrollments")
        .query({ studentId: studentProfileId })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(res.body.data.some((e: { id: string }) => e.id === enrollmentId)).toBe(true);
    });

    it("POST /crm/enrollments/:id/move moves the student to batch B", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/crm/enrollments/${enrollmentId}/move`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ toBatchId: fixtures.batchBId })
        .expect(200);
      expect(res.body.data.batchId).toBe(fixtures.batchBId);
    });

    it("POST /crm/enrollments/:id/withdraw sets status=dropped (does NOT soft-delete)", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/crm/enrollments/${enrollmentId}/withdraw`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ reason: "QA test withdrawal" })
        .expect(200);
      expect(res.body.data.status).toBe("dropped");

      const row = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
      expect(row!.deletedAt).toBeNull(); // confirms withdraw != soft-delete (documented nuance).
    });
  });

  describe("ENROLLMENT HARD-RESTORE (criterion #3 — the (studentId,batchId) unique-constraint contract)", () => {
    let studentProfileId: string;

    beforeAll(async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const studentRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          name: "QA Hard Restore Student",
          email: `qa-hard-restore-${Date.now()}@stimuliiq.test`,
          courseType: "btech",
          status: "active",
        })
        .expect(201);
      studentProfileId = studentRes.body.data.id;
      // Entitlement precondition: enroll() now requires a PAID order for the batch's program.
      await seedPaidOrder(prisma, { tenantId: fixtures.tenantId, studentId: studentProfileId, programId: fixtures.programId });
    });

    it("enroll -> arrange a soft-deleted (studentId,batchId) row (simulating withdrawn-and-removed) -> re-enroll into the SAME batch restores the row (no duplicate, no unique-constraint violation)", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      // Step 1: enroll for real via the public API.
      const firstEnroll = await request(app.getHttpServer())
        .post("/api/v1/crm/enrollments")
        .set(authHeaders(accessToken, csrfToken))
        .send({ studentId: studentProfileId, batchId: fixtures.batchAId })
        .expect(201);
      const firstEnrollmentId = firstEnroll.body.data.id;

      // Step 2: arrange a soft-deleted row for this exact (studentId, batchId) pair.
      // There is no public DELETE /crm/enrollments/:id route in P1 (withdraw() only sets
      // status="dropped", confirmed in enrollments.controller.ts/service.ts) — this direct
      // Prisma write is TEST ARRANGEMENT only (mirrors what a future hard-delete/withdraw
      // path, or test/soft-delete-audit.integration.spec.ts's own pattern, would produce),
      // not something we're asserting on the API's behalf.
      await prisma.enrollment.update({
        where: { id: firstEnrollmentId },
        data: { deletedAt: new Date() },
      });
      const softDeleted = await prisma.enrollment.findUnique({ where: { id: firstEnrollmentId } });
      expect(softDeleted!.deletedAt).not.toBeNull();

      // Step 3: re-enroll into the SAME batch via the public API.
      const secondEnroll = await request(app.getHttpServer())
        .post("/api/v1/crm/enrollments")
        .set(authHeaders(accessToken, csrfToken))
        .send({ studentId: studentProfileId, batchId: fixtures.batchAId })
        .expect(201);

      // MUST be the SAME row id (restored), never a second insert.
      expect(secondEnroll.body.data.id).toBe(firstEnrollmentId);
      expect(secondEnroll.body.data.status).toBe("active");

      const restored = await prisma.enrollment.findUnique({ where: { id: firstEnrollmentId } });
      expect(restored!.deletedAt).toBeNull();
      expect(restored!.status).toBe("active");

      // No duplicate row exists for this (studentId, batchId) pair.
      const allRowsForPair = await prisma.enrollment.findMany({
        where: { studentId: studentProfileId, batchId: fixtures.batchAId },
      });
      expect(allRowsForPair).toHaveLength(1);
    });
  });

  describe("enrollments REAL scope isolation (branch + assigned, via batch join)", () => {
    it("faculty B (assigned to batch B only) cannot enroll a student into batch A -> 403 enrollments.batch_out_of_scope", async () => {
      const { accessToken: adminToken, csrfToken: adminCsrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const studentRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(adminToken, adminCsrfToken))
        .send({
          name: "QA Faculty Scope Student",
          email: `qa-faculty-scope-${Date.now()}@stimuliiq.test`,
          courseType: "btech",
          status: "active",
        })
        .expect(201);

      const { accessToken: facultyBToken, csrfToken: facultyBCsrfToken } = await loginAs(FACULTY_B_EMAIL, FACULTY_B_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/enrollments")
        .set(authHeaders(facultyBToken, facultyBCsrfToken))
        .send({ studentId: studentRes.body.data.id, batchId: fixtures.batchAId })
        .expect(403);
      expect(res.body.error.code).toBe("enrollments.batch_out_of_scope");
    });
  });
});
