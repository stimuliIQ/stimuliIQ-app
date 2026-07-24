// apps/api/test/integration/crm-students-faculty.integration-spec.ts
//
// P1 CRM-core integration coverage (qa-engineer, Wave 5, docs/plans/phase-1.md task #8)
// for the students + faculty modules, run against REAL Postgres + Redis (testcontainers
// or ambient docker-compose fallback — see test/integration/global-setup.ts) and the
// REAL Nest AppModule (no mocks).
//
// Acceptance-criteria coverage map (docs/03 §20, qa-engineer task brief):
//   1. CRUD happy-path (students, faculty)         -> "students CRUD" / "faculty CRUD"
//   2. create-student/create-faculty TRANSACTION    -> "transaction: ..." tests
//   7. AUDIT-ON-MUTATION + secret redaction         -> "audit-on-mutation" describe blocks
//   8. IDOR (404, not 403, on cross-tenant/scope)   -> "IDOR" describe block (faculty)
//   5. students branch scope ISOLATION (Wave-3b)    -> "students REAL branch-scope
//      isolation" describe block — branch_manager (scope=branch on students.view) sees
//      only students enrolled in a batch within their own branch (resolved via
//      EnrollmentScopeRepository, see students.service.ts), never zero, never all, never
//      a blanket 403. "own"/unresolvable scope is still fail-closed (unchanged).
//
// SKIPS GRACEFULLY (describe.skip) when no Postgres/Redis could be resolved — see
// test/integration/global-setup.ts header comment.

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

describeIfAvailable("CRM students + faculty (CRUD, transaction, audit, IDOR, scope gap)", () => {
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
  } = require("../fixtures/crm-fixtures");
  const { MAIL_PROVIDER } = require("../../src/modules/notifications/providers/mail/mail-provider.interface");

  let app: import("@nestjs/common").INestApplication;
  let prisma: import("@prisma/client").PrismaClient;
  let fixtures: Awaited<ReturnType<typeof seedCrmFixtures>>;
  let mailSpy: { send: jest.Mock };

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

    // Gap-closing pass (GAP #2, resend-credentials): spy on MAIL_PROVIDER so the
    // "reissue LMS credentials" test can assert the welcome email was actually re-sent,
    // without depending on a real mail vendor.
    mailSpy = { send: jest.fn().mockResolvedValue({ providerMessageId: "msg-1" }) };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mailSpy)
      .compile();
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

  // ── 1 + 2. STUDENTS: CRUD happy-path + create-student TRANSACTION ────────────────────

  describe("students CRUD (super_admin, scope=all)", () => {
    const email = `qa-student-crud-${Date.now()}@stimuliiq.test`;
    let studentId: string;

    it("POST /crm/students creates a student", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "QA CRUD Student", email, courseType: "btech", status: "lead" })
        .expect(201);

      studentId = res.body.data.id;
      expect(res.body.data.email).toBe(email);
      // StudentDetail's `deletedAt` is `nullable()` (packages/types/src/crm/students.schemas.ts),
      // not optional — a freshly-created row is `null`, never `undefined`.
      expect(res.body.data.deletedAt).toBeNull();
    });

    it("transaction: creating a student creates User + UserRole(student) + StudentProfile, all tenant-scoped", async () => {
      const profile = await prisma.studentProfile.findUnique({ where: { id: studentId } });
      expect(profile).toBeTruthy();
      expect(profile!.tenantId).toBe(fixtures.tenantId);

      const user = await prisma.user.findUnique({ where: { id: profile!.userId } });
      expect(user).toBeTruthy();
      expect(user!.tenantId).toBe(fixtures.tenantId);
      expect(user!.email).toBe(email);

      const userRole = await prisma.userRole.findFirst({
        where: { userId: user!.id },
        include: { role: true },
      });
      expect(userRole).toBeTruthy();
      expect(userRole!.role.key).toBe("student");
    });

    it("GET /crm/students/:id retrieves the student", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/students/${studentId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(res.body.data.id).toBe(studentId);
    });

    it("GET /crm/students lists + filters/paginates", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/students")
        .query({ search: "QA CRUD Student", page: 1, pageSize: 10 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(res.body.data.some((s: { id: string }) => s.id === studentId)).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 10 });
    });

    it("PATCH /crm/students/:id updates the student", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/students/${studentId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ city: "Pune" })
        .expect(200);
      expect(res.body.data.city).toBe("Pune");
    });

    it("DELETE /crm/students/:id soft-deletes (hidden from default list)", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/students/${studentId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const row = await prisma.studentProfile.findUnique({ where: { id: studentId } });
      expect(row!.deletedAt).not.toBeNull();

      const list = await request(app.getHttpServer())
        .get("/api/v1/crm/students")
        .query({ search: "QA CRUD Student", page: 1, pageSize: 10 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(list.body.data.some((s: { id: string }) => s.id === studentId)).toBe(false);
    });

    it("POST /crm/students/:id/restore un-deletes it", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/crm/students/${studentId}/restore`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(res.body.data.deletedAt).toBeNull();
    });
  });

  // ── Gap-closing pass GAP #2: POST /crm/students/:id/resend-credentials ───────────────

  describe("students resend-credentials (gap-closing pass — CRM 'reissue LMS login' action)", () => {
    it("happy path: 200, returns the student's email, rotates the password + re-raises mustChangePassword, re-sends the welcome email", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const email = `qa-resend-creds-${Date.now()}@stimuliiq.test`;
      const createRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "QA Resend Creds Student", email, courseType: "btech", status: "active" })
        .expect(201);
      const studentId = createRes.body.data.id;

      const profile = await prisma.studentProfile.findUnique({ where: { id: studentId } });
      const beforeUser = await prisma.user.findUnique({ where: { id: profile!.userId } });
      expect(beforeUser!.passwordHash).toBe(""); // never provisioned yet (no enrollment/payment)

      mailSpy.send.mockClear();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/crm/students/${studentId}/resend-credentials`)
        .set(authHeaders(accessToken, csrfToken))
        .send({})
        .expect(200);
      expect(res.body.data.email).toBe(email);

      const afterUser = await prisma.user.findUnique({ where: { id: profile!.userId } });
      expect(afterUser!.mustChangePassword).toBe(true);
      expect(afterUser!.passwordHash).not.toBe("");
      expect(afterUser!.passwordHash).toMatch(/^\$argon2/);
      expect(afterUser!.status).toBe("active");

      expect(mailSpy.send).toHaveBeenCalledTimes(1);
      expect(mailSpy.send.mock.calls[0][0].to).toBe(email);

      // Calling it AGAIN rotates the credential a second time — unlike auto-provisioning,
      // this is NOT a one-shot idempotent no-op; each call is a fresh reissue.
      mailSpy.send.mockClear();
      const secondRes = await request(app.getHttpServer())
        .post(`/api/v1/crm/students/${studentId}/resend-credentials`)
        .set(authHeaders(accessToken, csrfToken))
        .send({})
        .expect(200);
      expect(secondRes.body.data.email).toBe(email);
      expect(mailSpy.send).toHaveBeenCalledTimes(1);

      const secondUser = await prisma.user.findUnique({ where: { id: profile!.userId } });
      expect(secondUser!.passwordHash).not.toBe(afterUser!.passwordHash); // rotated again
    });

    it("404 students.not_found for a non-existent id (IDOR posture — 404, not 403)", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/students/00000000-0000-0000-0000-000000000000/resend-credentials")
        .set(authHeaders(accessToken, csrfToken))
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe("students.not_found");
    });

    it("403 auth.forbidden without students.edit (faculty has no students.* grant)", async () => {
      const { accessToken: adminAT, csrfToken: adminCSRF } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const email = `qa-resend-creds-denied-${Date.now()}@stimuliiq.test`;
      const createRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(adminAT, adminCSRF))
        .send({ name: "QA Resend Creds Denied", email, courseType: "btech", status: "active" })
        .expect(201);
      const studentId = createRes.body.data.id;

      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/crm/students/${studentId}/resend-credentials`)
        .set(authHeaders(accessToken, csrfToken))
        .send({})
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");
    });
  });

  describe("students audit-on-mutation (§20b)", () => {
    it("create + update + delete each write an audit_logs row with actor/entity/action/before-after", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const email = `qa-student-audit-${Date.now()}@stimuliiq.test`;

      const createRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "QA Audit Student", email, courseType: "mca", status: "lead" })
        .expect(201);
      const studentId = createRes.body.data.id;

      const createAudit = await prisma.auditLog.findFirst({
        where: { entity: "StudentProfile", entityId: studentId, action: "create" },
        orderBy: { createdAt: "desc" },
      });
      expect(createAudit).toBeTruthy();
      expect(createAudit!.actorId).toBeTruthy();

      await request(app.getHttpServer())
        .patch(`/api/v1/crm/students/${studentId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ city: "Chennai" })
        .expect(200);

      const updateAudit = await prisma.auditLog.findFirst({
        where: { entity: "StudentProfile", entityId: studentId, action: "update" },
        orderBy: { createdAt: "desc" },
      });
      expect(updateAudit).toBeTruthy();
      expect((updateAudit!.after as Record<string, unknown>).city).toBe("Chennai");

      await request(app.getHttpServer())
        .delete(`/api/v1/crm/students/${studentId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const deleteAudit = await prisma.auditLog.findFirst({
        where: { entity: "StudentProfile", entityId: studentId, action: "delete" },
        orderBy: { createdAt: "desc" },
      });
      expect(deleteAudit).toBeTruthy();

      // Surfaced via GET /crm/audit-logs with a working entity filter.
      const auditList = await request(app.getHttpServer())
        .get("/api/v1/crm/audit-logs")
        .query({ entity: "StudentProfile", entityId: studentId, page: 1, pageSize: 20 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const actions = auditList.body.data.map((row: { action: string }) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["create", "update", "delete"]));
    });

    it("does not leak User secret fields (passwordHash/refreshHash) into audit before/after", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const email = `qa-student-secret-${Date.now()}@stimuliiq.test`;
      const createRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "QA Secret Student", email, courseType: "mba" })
        .expect(201);

      const profile = await prisma.studentProfile.findUnique({ where: { id: createRes.body.data.id } });
      const userAudit = await prisma.auditLog.findFirst({
        where: { entity: "User", entityId: profile!.userId, action: "create" },
        orderBy: { createdAt: "desc" },
      });
      expect(userAudit).toBeTruthy();
      const afterJson = JSON.stringify(userAudit!.after);
      expect(afterJson).not.toMatch(/passwordHash|password_hash/i);
      expect(afterJson).not.toMatch(/refreshHash|refresh_hash/i);
    });
  });

  describe("students REAL branch-scope isolation (Wave-3b: resolved via EnrollmentScopeRepository)", () => {
    let branchBStudentId: string;

    beforeAll(async () => {
      // Arrange a second student enrolled in branch B's batch (fixtures only seed one
      // pre-enrolled student, in branch A's batch) so isolation can be proven both ways:
      // branch_manager (branch A) must see the branch-A student and must NOT see this one.
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const createRes = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          name: "QA Branch B Isolation Student",
          email: `qa-branch-b-student-${Date.now()}@stimuliiq.test`,
          courseType: "btech",
          status: "active",
        })
        .expect(201);
      branchBStudentId = createRes.body.data.id;

      // Entitlement precondition: enroll() now requires a PAID order for the batch's program.
      await seedPaidOrder(prisma, { tenantId: fixtures.tenantId, studentId: branchBStudentId, programId: fixtures.programId });

      await request(app.getHttpServer())
        .post("/api/v1/crm/enrollments")
        .set(authHeaders(accessToken, csrfToken))
        .send({ studentId: branchBStudentId, batchId: fixtures.batchBId })
        .expect(201);
    });

    it("branch_manager (scope=branch on students.view, branch A) sees the branch-A student, NOT the branch-B student, NOT a blanket 403", async () => {
      const { accessToken, csrfToken } = await loginAs(BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/students?pageSize=100")
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).toContain(fixtures.seededStudentProfileId);
      expect(ids).not.toContain(branchBStudentId);
      // Real isolation, not "match zero rows": the branch-A student must actually appear.
      expect(ids.length).toBeGreaterThan(0);
    });

    it("IDOR: branch_manager (branch A) GET on the branch-B student's id returns 404 (not 403, not the row)", async () => {
      const { accessToken, csrfToken } = await loginAs(BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/students/${branchBStudentId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(404);
      expect(res.body.error.code).toBe("students.not_found");
    });
  });

  // ── FACULTY: CRUD + transaction + REAL branch-scope isolation ────────────────────────

  describe("faculty CRUD (super_admin, scope=all)", () => {
    const email = `qa-faculty-crud-${Date.now()}@stimuliiq.test`;
    let facultyId: string;

    it("POST /crm/faculty creates faculty", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/faculty")
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "QA CRUD Faculty", email, expertise: ["QA"], branchId: fixtures.branchAId })
        .expect(201);
      facultyId = res.body.data.id;
      expect(res.body.data.branchId).toBe(fixtures.branchAId);
    });

    it("transaction: creating faculty creates User + UserRole(faculty) + FacultyProfile, all tenant-scoped", async () => {
      const profile = await prisma.facultyProfile.findUnique({ where: { id: facultyId } });
      expect(profile!.tenantId).toBe(fixtures.tenantId);

      const user = await prisma.user.findUnique({ where: { id: profile!.userId } });
      expect(user!.tenantId).toBe(fixtures.tenantId);

      const userRole = await prisma.userRole.findFirst({ where: { userId: user!.id }, include: { role: true } });
      expect(userRole!.role.key).toBe("faculty");
      expect(userRole!.branchId).toBe(fixtures.branchAId);
    });

    it("GET, PATCH, DELETE, restore round-trip", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .get(`/api/v1/crm/faculty/${facultyId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/crm/faculty/${facultyId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ bio: "Updated bio" })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/crm/faculty/${facultyId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const deleted = await prisma.facultyProfile.findUnique({ where: { id: facultyId } });
      expect(deleted!.deletedAt).not.toBeNull();

      const restoreRes = await request(app.getHttpServer())
        .post(`/api/v1/crm/faculty/${facultyId}/restore`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(restoreRes.body.data.deletedAt).toBeNull();
    });
  });

  describe("faculty REAL branch-scope isolation (branch_manager sees only their branch)", () => {
    it("branch_manager (branch A) sees faculty A in list, does NOT see faculty B", async () => {
      const { accessToken, csrfToken } = await loginAs(BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/faculty")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const ids = res.body.data.map((f: { id: string }) => f.id);
      expect(ids).toContain(fixtures.facultyAProfileId);
      expect(ids).not.toContain(fixtures.facultyBProfileId);
    });

    it("IDOR: branch_manager (branch A) GET on faculty B's id returns 404 (not 403, not the row)", async () => {
      const { accessToken, csrfToken } = await loginAs(BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/faculty/${fixtures.facultyBProfileId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(404);
      expect(res.body.error.code).toBe("faculty.not_found");
    });

    it("IDOR: branch_manager (branch A) DELETE on faculty B's id returns 404", async () => {
      const { accessToken, csrfToken } = await loginAs(BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD);
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/faculty/${fixtures.facultyBProfileId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(404);

      // Confirm it really was NOT deleted (proves 404 is a true deny, not a successful op
      // disguised by a wrong status code).
      const row = await prisma.facultyProfile.findUnique({ where: { id: fixtures.facultyBProfileId } });
      expect(row!.deletedAt).toBeNull();
    });
  });

  // ── RBAC allow/deny matrix (§9 + §20a) ────────────────────────────────────────────────

  describe("RBAC deny-by-default + forbidden-action-blocked (§9 matrix, §20a)", () => {
    it("faculty role hitting admin/roles is 403 (no roles.* grant seeded for faculty)", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/admin/roles")
        .set(authHeaders(accessToken, csrfToken))
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");
    });

    it("faculty role hitting admin/branches is 403 (no branches.* grant seeded for faculty)", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/admin/branches")
        .set(authHeaders(accessToken, csrfToken))
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");
    });

    it("branch_manager hitting admin/roles is 403 (no roles.* grant seeded for branch_manager)", async () => {
      const { accessToken, csrfToken } = await loginAs(BRANCH_MANAGER_EMAIL, BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/admin/roles")
        .set(authHeaders(accessToken, csrfToken))
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");
    });

    it("the 403 is enforced SERVER-SIDE: faculty cannot bypass by simply calling the route with any token shape — missing permission always denies regardless of body/query", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/admin/branches")
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "Should never be created", city: "Nowhere", status: "active" })
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");

      const created = await prisma.branch.findFirst({ where: { name: "Should never be created" } });
      expect(created).toBeNull();
    });
  });
});
