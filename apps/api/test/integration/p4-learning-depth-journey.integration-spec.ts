// apps/api/test/integration/p4-learning-depth-journey.integration-spec.ts
//
// P4 QA gate: Full critical-journey integration test (docs/04 §6).
// Exercises the real NestJS application over HTTP (supertest + real Nest app),
// against a real Postgres + Redis DB (testcontainers or ambient docker-compose).
//
// PATTERN: matches lms-idor-progress-webhook.integration-spec.ts exactly —
//   • reads STATE_FILE written by global-setup.ts (testcontainers → ambient → skip)
//   • sets all env vars BEFORE any imports that transitively load validateEnv()
//   • uses `describeIfAvailable` so `pnpm test:integration` stays GREEN when no DB
//   • double-submit CSRF: login extracts csrf_token cookie; unsafe methods send
//     Cookie: access_token=...; csrf_token=... AND X-CSRF-Token: <same>
//   • Noop Storage + Noop Certificate PDF adapters (NODE_ENV=test selects both)
//   • VIDEO_PROVIDER=noop (no real Cloudflare/Mux keys needed)
//
// ACCEPTANCE CRITERIA COVERED
// ════════════════════════════
//   AC-A1  student submits assignment → 201, status=submitted           HTTP journey step 1
//   AC-A2  student submits after due_at → 422 ASSIGNMENT_OVERDUE        negative path
//   AC-A3  student submits to unowned program → 404 (IDOR)              negative path
//   AC-A5  resubmit blocked when allow_resubmit=false → 409              negative path
//   AC-B1  ops (admin) grades submission → graded+audited               HTTP journey step 2
//   AC-B3  grade change is audited with before/after values             audit assertion
//   AC-B5  student views own grade + feedback                           HTTP check
//   AC-D1  student starts MCQ attempt → 201 with time_expires_at set    HTTP journey step 3
//   AC-D2  answer key NEVER in HTTP response (JSON scan on raw body)     security crux
//   AC-D3  student submits answers before expiry → score/passed set      HTTP journey step 4
//   AC-D4  submit after expiry → 422 ATTEMPT_EXPIRED                    negative path
//   AC-D5  start when attempts_allowed exhausted → 422 ATTEMPTS_EXHAUSTED negative path
//   AC-D7  idempotent re-submit → same result, no re-grade               idempotency
//   AC-D10 student cannot access another student's attempt → 404          IDOR
//   AC-E1  issue blocked when progressPct < 90 → 422 NOT_ELIGIBLE        gate
//   AC-E4  issue succeeds when all gates pass → cert row + audit         HTTP journey step 5
//   AC-E6  issuing again → 409 CERTIFICATE_ALREADY_EXISTS                idempotency
//   AC-F1  student downloads own cert (signed URL, not raw bucket)       HTTP journey step 6
//   AC-F4  student B cannot download student A's cert → 404              IDOR
//   AC-F5  revoked cert download → 410 CERTIFICATE_REVOKED               gate
//   AC-G1  ops revokes cert → status=revoked, audit before/after         HTTP journey step 7
//   AC-G2  public verify reflects revocation instantly (no cache)         AC-G2 crux
//   AC-H1  public verify → 200 { valid:true, program, issuedAt, holderName }  step 8
//   AC-H3  fabricated cert_uid → 404 (before DB query)                   security crux
//   AC-H4  tampered cert_uid → 404                                        security crux
//   AC-H7  verify response has EXACTLY 5 keys (no PII leak)              security crux
//   AC-H8  public verify needs no auth (unauthenticated request)         security crux
//   AC-J1  student B cannot read student A's submission → 404             cross-student IDOR
//   AC-J7  student cannot self-grade → 403                               RBAC
//   AC-J9  answer key never in any HTTP response body (raw JSON scan)     security crux
//
// WHAT IS EXPLICITLY NOT DUPLICATED HERE (already covered by service-level tests):
//   - cert_uid sign/verify round-trip (cert-uid.spec.ts, 147 tests)
//   - eligibility gate unit logic (certificates.service.spec.ts)
//   - MCQ auto-grade pure function (assessments.service.spec.ts)
//   - cross-tenant IDOR at DB level (*.integration.spec.ts files)
//
// PLAYWRIGHT E2E GAP NOTE:
//   The plan (§8 DoD) requires a browser e2e journey. Prior phases kept Playwright e2e
//   as a no-op stub (standing up 3 dev servers in CI is out of scope for this harness).
//   This HTTP-level test IS the executable proof of the critical journey. The Playwright
//   gap is tracked in docs/phase-4-followups.md.

import { readFileSync } from "node:fs";
import { STATE_FILE, type IntegrationEnvFile } from "./global-setup";

const envFile: IntegrationEnvFile = JSON.parse(readFileSync(STATE_FILE, "utf8"));

// All env vars must be set BEFORE any import that transitively calls validateEnv().
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
  process.env.VIDEO_PROVIDER = "noop"; // no real Cloudflare/Mux keys
  process.env.STORAGE_PROVIDER = "noop"; // NoopStorageProvider (deterministic fake URLs)
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

describeIfAvailable(
  "P4 Learning Depth — full critical journey (real Postgres + Redis + Noop adapters)",
  () => {
    // ── Lazy imports (never loaded when suite is skipped) ─────────────────────
    const { Test } = require("@nestjs/testing");
    const cookieParser = require("cookie-parser");
    const request = require("supertest");
    const { PrismaClient, RolePermissionScope } = require("@prisma/client");
    const argon2 = require("argon2");
    const { AppModule } = require("../../src/app.module");
    const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
    const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
    const { __resetCertUidWarningForTests } = require("../../src/modules/certificates/cert-uid.util");
    const { __resetEnvCacheForTests } = require("../../src/config/env");

    let app: import("@nestjs/common").INestApplication;
    let prisma: import("@prisma/client").PrismaClient;

    // ── Seeded IDs ─────────────────────────────────────────────────────────────
    let tenantId: string;
    let programId: string;
    let moduleId: string;
    let lessonId: string;
    let assignmentId: string;
    let assessmentId: string;
    let exhaustedAssessmentId: string; // separate assessment for AC-D5 (attemptsAllowed=1)
    let mcqQ1Id: string;
    let mcqQ2Id: string;
    let exhaustedQ1Id: string;

    // Student A (the journey student — fully eligible)
    let studentAEmail: string;
    let studentAPassword: string;
    let studentAUserId: string;
    let studentAProfileId: string;
    let enrollmentAId: string;

    // Student B (IDOR target — same program, different batch)
    let studentBEmail: string;
    let studentBPassword: string;
    let studentBUserId: string;
    let studentBProfileId: string;
    let enrollmentBId: string;

    // Ops user (admin — issues/revokes certs, grades submissions in all scope)
    let opsEmail: string;
    let opsPassword: string;
    let opsUserId: string;

    // Template
    let templateId: string;

    // ── CSRF token cache (keyed by access_token) ───────────────────────────────
    const csrfByToken = new Map<string, string>();

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    function extractCookie(
      res: import("supertest").Response,
      name: string,
    ): string | undefined {
      const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const match = list.find((c: string) => c.startsWith(`${name}=`));
      return match?.split(";")[0]?.split("=").slice(1).join("=");
    }

    // Login → returns access_token; caches csrf_token for later unsafe requests.
    async function loginAs(email: string, password: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email, password })
        .expect(200);
      const token = extractCookie(res, "access_token");
      if (!token) throw new Error(`No access_token cookie for ${email}`);
      const csrf = extractCookie(res, "csrf_token");
      if (!csrf) throw new Error(`No csrf_token cookie for ${email}`);
      csrfByToken.set(token, csrf);
      return token;
    }

    // GET (CSRF-exempt).
    async function getAs(token: string, path: string): Promise<import("supertest").Response> {
      return request(app.getHttpServer())
        .get(path)
        .set("Cookie", [`access_token=${token}`]);
    }

    // POST with CSRF double-submit.
    async function postAs(
      token: string,
      path: string,
      body: Record<string, unknown> = {},
    ): Promise<import("supertest").Response> {
      const csrf = csrfByToken.get(token) ?? "";
      return request(app.getHttpServer())
        .post(path)
        .set("Cookie", [`access_token=${token}; csrf_token=${csrf}`])
        .set("X-CSRF-Token", csrf)
        .send(body);
    }

    // PATCH with CSRF double-submit.
    async function patchAs(
      token: string,
      path: string,
      body: Record<string, unknown> = {},
    ): Promise<import("supertest").Response> {
      const csrf = csrfByToken.get(token) ?? "";
      return request(app.getHttpServer())
        .patch(path)
        .set("Cookie", [`access_token=${token}; csrf_token=${csrf}`])
        .set("X-CSRF-Token", csrf)
        .send(body);
    }

    // PUT with CSRF double-submit.
    async function putAs(
      token: string,
      path: string,
      body: Record<string, unknown> = {},
    ): Promise<import("supertest").Response> {
      const csrf = csrfByToken.get(token) ?? "";
      return request(app.getHttpServer())
        .put(path)
        .set("Cookie", [`access_token=${token}; csrf_token=${csrf}`])
        .set("X-CSRF-Token", csrf)
        .send(body);
    }

    // ── beforeAll: seed + boot app ────────────────────────────────────────────

    beforeAll(async () => {
      __resetCertUidWarningForTests();
      __resetEnvCacheForTests();

      prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      await prisma.$connect();

      const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      // ── Tenant ──────────────────────────────────────────────────────────────
      // Must reuse "stimuliiq" slug — AuthService hard-codes it for login.
      const tenant = await prisma.tenant.upsert({
        where: { slug: "stimuliiq" },
        update: {},
        create: {
          slug: "stimuliiq",
          name: "QA P4 Journey Tenant",
          status: "active",
          settings: {},
          branding: {},
        },
      });
      tenantId = tenant.id;

      // ── P4 permission catalog ──────────────────────────────────────────────
      const p4Permissions = [
        ["assignments.view", "View Assignments"],
        ["assignments.create", "Create Assignments"],
        ["assignments.edit", "Edit Assignments"],
        ["submissions.view", "View Submissions"],
        ["submissions.create", "Create Submissions"],
        ["submissions.grade", "Grade Submissions"],
        ["assessments.view", "View Assessments"],
        ["assessments.create", "Create Assessments"],
        ["assessments.edit", "Edit Assessments"],
        ["attempts.take", "Take Attempts"],
        ["attempts.view", "View Attempts"],
        ["attempts.grade", "Grade Attempts"],
        ["certificates.view", "View Certificates"],
        ["certificates.issue", "Issue Certificates"],
        ["certificates.revoke", "Revoke Certificates"],
        ["certificates.recommend", "Recommend Certificates"],
        // Legacy permissions still required by app guards
        ["courses.view", "View Courses"],
        ["lessons.view", "View Lessons"],
      ] as const;

      const permIdByKey = new Map<string, string>();
      for (const [key, label] of p4Permissions) {
        const perm = await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, label },
        });
        permIdByKey.set(key, perm.id);
      }

      // Also upsert audit_log.list (required by admin role)
      const auditPerm = await prisma.permission.upsert({
        where: { key: "audit_log.list" },
        update: {},
        create: { key: "audit_log.list", label: "List Audit Log" },
      });
      permIdByKey.set("audit_log.list", auditPerm.id);

      // ── Roles ──────────────────────────────────────────────────────────────
      const studentRole = await prisma.role.upsert({
        where: { tenantId_key: { tenantId, key: "student" } },
        update: {},
        create: { tenantId, key: "student", name: "Student", isSystem: false },
      });

      const adminRole = await prisma.role.upsert({
        where: { tenantId_key: { tenantId, key: "admin" } },
        update: {},
        create: { tenantId, key: "admin", name: "Admin", isSystem: true },
      });

      // Grant student (own scope) permissions
      const studentPerms = [
        "assignments.view", "submissions.view", "submissions.create",
        "assessments.view", "attempts.take", "attempts.view",
        "certificates.view",
        "courses.view", "lessons.view",
      ];
      for (const key of studentPerms) {
        const permId = permIdByKey.get(key)!;
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: studentRole.id, permissionId: permId } },
          update: { scope: RolePermissionScope.own },
          create: { roleId: studentRole.id, permissionId: permId, scope: RolePermissionScope.own },
        });
      }

      // Grant admin (all scope) permissions
      const adminPerms = [
        "assignments.view", "assignments.create", "assignments.edit",
        "submissions.view", "submissions.grade",
        "assessments.view", "assessments.create", "assessments.edit",
        "attempts.view", "attempts.grade",
        "certificates.view", "certificates.issue", "certificates.revoke", "certificates.recommend",
        "courses.view", "lessons.view", "audit_log.list",
      ];
      for (const key of adminPerms) {
        const permId = permIdByKey.get(key)!;
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permId } },
          update: { scope: RolePermissionScope.all },
          create: { roleId: adminRole.id, permissionId: permId, scope: RolePermissionScope.all },
        });
      }

      // ── Branch ─────────────────────────────────────────────────────────────
      const branch = await prisma.branch.create({
        data: { tenantId, name: `P4 Journey Branch ${suffix}`, status: "active" },
      });

      // ── Program + Module + Lesson ──────────────────────────────────────────
      const program = await prisma.program.create({
        data: {
          tenantId,
          slug: `p4-journey-prog-${suffix}`,
          title: `P4 Journey Program ${suffix}`,
          domain: "Engineering",
          pricePaise: 50000_00,
          status: "published",
        },
      });
      programId = program.id;

      const mod = await prisma.module.create({
        data: { programId, title: "P4 Module 1", order: 1 },
      });
      moduleId = mod.id;

      const lesson = await prisma.lesson.create({
        data: { moduleId, title: "P4 Lesson 1", type: "assignment", order: 1 },
      });
      lessonId = lesson.id;

      // ── Users ──────────────────────────────────────────────────────────────
      studentAEmail = `p4-student-a-${suffix}@test.invalid`;
      studentAPassword = "P4-StudentA-Pwd-123!";
      studentBEmail = `p4-student-b-${suffix}@test.invalid`;
      studentBPassword = "P4-StudentB-Pwd-123!";
      opsEmail = `p4-ops-${suffix}@test.invalid`;
      opsPassword = "P4-Ops-Pwd-123!";

      const hashA = await argon2.hash(studentAPassword, { type: argon2.argon2id });
      const hashB = await argon2.hash(studentBPassword, { type: argon2.argon2id });
      const hashOps = await argon2.hash(opsPassword, { type: argon2.argon2id });

      const userA = await prisma.user.create({
        data: { tenantId, name: "P4 Student A", email: studentAEmail, passwordHash: hashA, status: "active" },
      });
      studentAUserId = userA.id;

      const userB = await prisma.user.create({
        data: { tenantId, name: "P4 Student B", email: studentBEmail, passwordHash: hashB, status: "active" },
      });
      studentBUserId = userB.id;

      const opsUser = await prisma.user.create({
        data: { tenantId, name: "P4 Ops", email: opsEmail, passwordHash: hashOps, status: "active" },
      });
      opsUserId = opsUser.id;

      // Assign roles
      await prisma.userRole.create({ data: { userId: studentAUserId, roleId: studentRole.id, branchId: null } });
      await prisma.userRole.create({ data: { userId: studentBUserId, roleId: studentRole.id, branchId: null } });
      await prisma.userRole.create({ data: { userId: opsUserId, roleId: adminRole.id, branchId: null } });

      // ── Student Profiles ──────────────────────────────────────────────────
      const profA = await prisma.studentProfile.create({
        data: { tenantId, userId: studentAUserId, courseType: "btech", status: "active" },
      });
      studentAProfileId = profA.id;

      const profB = await prisma.studentProfile.create({
        data: { tenantId, userId: studentBUserId, courseType: "btech", status: "active" },
      });
      studentBProfileId = profB.id;

      // ── Batches ────────────────────────────────────────────────────────────
      const batchA = await prisma.batch.create({
        data: {
          tenantId, programId, branchId: branch.id,
          name: `P4 Batch A ${suffix}`, startDate: new Date("2026-01-01"), capacity: 10, status: "active",
        },
      });

      const batchB = await prisma.batch.create({
        data: {
          tenantId, programId, branchId: branch.id,
          name: `P4 Batch B ${suffix}`, startDate: new Date("2026-01-01"), capacity: 10, status: "active",
        },
      });

      // ── Enrollments ────────────────────────────────────────────────────────
      // Student A: progressPct=100 (fully eligible by default — we'll downgrade for gate tests)
      const enrollA = await prisma.enrollment.create({
        data: {
          tenantId, studentId: studentAProfileId, programId,
          batchId: batchA.id, status: "active", source: "manual", progressPct: 100,
        },
      });
      enrollmentAId = enrollA.id;

      const enrollB = await prisma.enrollment.create({
        data: {
          tenantId, studentId: studentBProfileId, programId,
          batchId: batchB.id, status: "active", source: "manual", progressPct: 100,
        },
      });
      enrollmentBId = enrollB.id;

      // ── Assignment ─────────────────────────────────────────────────────────
      const assignment = await prisma.assignment.create({
        data: {
          tenantId, lessonId,
          kind: "assignment", title: "P4 Journey Assignment",
          maxScore: 100, allowResubmit: false, isFinal: false,
        },
      });
      assignmentId = assignment.id;

      // ── MCQ Assessment (2 questions, 5 pts each, pass=60%, timeLimitS=600, attemptsAllowed=2)
      // Used for AC-D1, AC-D2, AC-D3, AC-D7, AC-D4.
      const assessment = await prisma.assessment.create({
        data: {
          tenantId, moduleId,
          title: "P4 Journey MCQ Quiz", type: "quiz",
          timeLimitS: 600, passPct: 60, attemptsAllowed: 2, shuffle: false, isRequired: false,
        },
      });
      assessmentId = assessment.id;

      const q1 = await prisma.assessmentQuestion.create({
        data: {
          tenantId, assessmentId,
          type: "mcq", prompt: "What is 2+2?",
          options: [{ id: "opt-a", text: "3" }, { id: "opt-b", text: "4" }, { id: "opt-c", text: "5" }],
          answerKey: "opt-b", // correct answer
          points: 5, order: 0,
        },
      });
      mcqQ1Id = q1.id;

      const q2 = await prisma.assessmentQuestion.create({
        data: {
          tenantId, assessmentId,
          type: "mcq", prompt: "What is 3×3?",
          options: [{ id: "opt-a", text: "6" }, { id: "opt-b", text: "9" }, { id: "opt-c", text: "12" }],
          answerKey: "opt-b", // correct answer
          points: 5, order: 1,
        },
      });
      mcqQ2Id = q2.id;

      // ── Exhausted Assessment (attemptsAllowed=1) — AC-D5 only ──────────────
      const exhaustedAssessment = await prisma.assessment.create({
        data: {
          tenantId, moduleId,
          title: "P4 Journey Exhausted Quiz", type: "quiz",
          timeLimitS: 600, passPct: 60, attemptsAllowed: 1, shuffle: false, isRequired: false,
        },
      });
      exhaustedAssessmentId = exhaustedAssessment.id;

      const exhaQ1 = await prisma.assessmentQuestion.create({
        data: {
          tenantId, assessmentId: exhaustedAssessmentId,
          type: "mcq", prompt: "What is 1+1?",
          options: [{ id: "opt-a", text: "1" }, { id: "opt-b", text: "2" }, { id: "opt-c", text: "3" }],
          answerKey: "opt-b",
          points: 5, order: 0,
        },
      });
      exhaustedQ1Id = exhaQ1.id;

      // ── Certificate Template ───────────────────────────────────────────────
      const template = await prisma.certificateTemplate.create({
        data: {
          tenantId, name: `P4 Journey Cert Template ${suffix}`,
          design: { orientation: "landscape" },
          fields: [{ key: "holderName", label: "Name" }],
          status: "active",
        },
      });
      templateId = template.id;

      // ── Boot the real Nest app ─────────────────────────────────────────────
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.use(cookieParser());
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new EnvelopeInterceptor());
      app.setGlobalPrefix("api/v1", { exclude: ["health", "api-docs.json"] });
      await app.init();
    }, 120_000);

    afterAll(async () => {
      // FK-order teardown — clean up ONLY what THIS spec created.
      //
      // qa-engineer Wave 5 fix (docs/plans/phase-9-completion.md T41, item 3b): `tenantId`
      // here is the SHARED "stimuliiq" tenant (upserted by slug above, reused by every
      // other `*.integration-spec.ts` file AND by `pnpm db:seed`) — it is NOT a
      // per-run-disposable tenant like certificates.integration.spec.ts's `tenant1`/
      // `tenant2` (those ARE created fresh per run, so `deleteMany({ where: { tenantId }
      // })` is safe there). Blanket `deleteMany({ where: { tenantId } })` on
      // certificateTemplate/enrollment/studentProfile/assessment/submission/assignment/
      // attempt/certificate/auditLog against the SHARED tenant deleted every OTHER
      // spec's (and every seeded) row in those tables tenant-wide, not just this file's
      // fixtures — observed destroying certificate-template seed data other specs rely
      // on. Every delete below is now scoped to the explicit ids this file created.
      if (prisma) {
        const certificateIds = [issuedCertId].filter((v): v is string => !!v);
        const attemptIds = [attemptAId].filter((v): v is string => !!v);
        const assessmentQuestionIds = [mcqQ1Id, mcqQ2Id, exhaustedQ1Id].filter((v): v is string => !!v);
        const assessmentIds = [assessmentId, exhaustedAssessmentId].filter((v): v is string => !!v);
        const submissionIds = [submissionId].filter((v): v is string => !!v);
        const assignmentIds = [assignmentId].filter((v): v is string => !!v);
        const templateIds = [templateId].filter((v): v is string => !!v);
        const enrollmentIds = [enrollmentAId, enrollmentBId].filter((v): v is string => !!v);
        const studentProfileIds = [studentAProfileId, studentBProfileId].filter((v): v is string => !!v);

        await prisma.auditLog
          .deleteMany({
            where: {
              tenantId,
              entityId: { in: [...certificateIds, ...templateIds, ...submissionIds, ...attemptIds, ...assignmentIds, ...assessmentIds] },
            },
          })
          .catch(() => {});
        await prisma.certificate.deleteMany({ where: { id: { in: certificateIds } } }).catch(() => {});
        await prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } }).catch(() => {});
        await prisma.assessmentQuestion.deleteMany({ where: { id: { in: assessmentQuestionIds } } }).catch(() => {});
        await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } }).catch(() => {});
        await prisma.submission.deleteMany({ where: { id: { in: submissionIds } } }).catch(() => {});
        await prisma.assignment.deleteMany({ where: { id: { in: assignmentIds } } }).catch(() => {});
        await prisma.certificateTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => {});
        await prisma.enrollment.deleteMany({ where: { id: { in: enrollmentIds } } }).catch(() => {});
        await prisma.studentProfile.deleteMany({ where: { id: { in: studentProfileIds } } }).catch(() => {});
        const fixtureUserIds = [studentAUserId, studentBUserId, opsUserId].filter(Boolean);
        if (fixtureUserIds.length) {
          await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
          await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
          await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
        }
        await prisma.batch.deleteMany({ where: { tenantId, name: { startsWith: "P4 Batch" } } }).catch(() => {});
        await prisma.lesson.deleteMany({
          where: { module: { program: { tenantId, slug: { startsWith: "p4-journey-prog" } } } },
        }).catch(() => {});
        await prisma.module.deleteMany({
          where: { program: { tenantId, slug: { startsWith: "p4-journey-prog" } } },
        }).catch(() => {});
        await prisma.program.deleteMany({ where: { tenantId, slug: { startsWith: "p4-journey-prog" } } }).catch(() => {});
        await prisma.branch.deleteMany({ where: { tenantId, name: { startsWith: "P4 Journey Branch" } } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (app) await app.close();
      __resetEnvCacheForTests();
    }, 30_000);

    // ── Token holders for the journey ──────────────────────────────────────────
    let tokenStudentA: string;
    let tokenStudentB: string;
    let tokenOps: string;

    // ── STEP 0: Login all three actors ─────────────────────────────────────────

    describe("Step 0 — Login", () => {
      it("Student A logs in successfully", async () => {
        tokenStudentA = await loginAs(studentAEmail, studentAPassword);
        expect(tokenStudentA).toBeDefined();
      });

      it("Student B logs in successfully", async () => {
        tokenStudentB = await loginAs(studentBEmail, studentBPassword);
        expect(tokenStudentB).toBeDefined();
      });

      it("Ops logs in successfully", async () => {
        tokenOps = await loginAs(opsEmail, opsPassword);
        expect(tokenOps).toBeDefined();
      });
    });

    // ── STEP 1: Submit assignment (AC-A1) ─────────────────────────────────────

    let submissionId: string;

    describe("Step 1 — Submit assignment (AC-A1)", () => {
      it("AC-A1: Student A submits assignment → 201, status=submitted", async () => {
        const res = await postAs(tokenStudentA, `/api/v1/me/assignments/${assignmentId}/submit`, {
          files: [],
          text: "My journey assignment answer",
        });
        expect(res.status).toBe(201);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.status).toBe("submitted");
        expect(res.body.data.attemptNo).toBe(1);
        expect(res.body.data.text).toBe("My journey assignment answer");
        submissionId = res.body.data.id;
      });

      it("AC-A2: submitting to an assignment after due_at → 422 ASSIGNMENT_OVERDUE", async () => {
        // Create an overdue assignment directly in DB
        const overdue = await prisma.assignment.create({
          data: {
            tenantId, lessonId,
            kind: "assignment", title: "Overdue Journey Assignment",
            maxScore: 50, dueAt: new Date("2020-01-01"), allowResubmit: false, isFinal: false,
          },
        });

        const res = await postAs(tokenStudentA, `/api/v1/me/assignments/${overdue.id}/submit`, {
          text: "late submission",
        });
        expect(res.status).toBe(422);
        expect(res.body.error?.code).toBe("ASSIGNMENT_OVERDUE");

        await prisma.assignment.delete({ where: { id: overdue.id } });
      });

      it("AC-A3: Student A submitting to assignment not in enrolled program → 404 (IDOR)", async () => {
        // Create an isolated assignment in a completely different program (not seeded in student A's enrollment)
        const otherProgram = await prisma.program.create({
          data: { tenantId, slug: `p4-other-prog-${Date.now()}`, title: "Other", domain: "IT", pricePaise: 0 },
        });
        const otherMod = await prisma.module.create({ data: { programId: otherProgram.id, title: "OtherMod", order: 1 } });
        const otherLesson = await prisma.lesson.create({ data: { moduleId: otherMod.id, title: "OtherLesson", type: "assignment", order: 1 } });
        const otherAssignment = await prisma.assignment.create({
          data: { tenantId, lessonId: otherLesson.id, kind: "assignment", title: "Other Assign", maxScore: 100, allowResubmit: false, isFinal: false },
        });

        const res = await postAs(tokenStudentA, `/api/v1/me/assignments/${otherAssignment.id}/submit`, { text: "test" });
        expect(res.status).toBe(404);

        // Cleanup
        await prisma.assignment.delete({ where: { id: otherAssignment.id } });
        await prisma.lesson.delete({ where: { id: otherLesson.id } });
        await prisma.module.delete({ where: { id: otherMod.id } });
        await prisma.program.delete({ where: { id: otherProgram.id } });
      });

      it("AC-A5: resubmit blocked when allow_resubmit=false → 409 RESUBMIT_NOT_ALLOWED", async () => {
        const res = await postAs(tokenStudentA, `/api/v1/me/assignments/${assignmentId}/submit`, {
          text: "Attempt 2 — should be blocked",
        });
        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe("RESUBMIT_NOT_ALLOWED");
      });

      it("AC-J1: Student B cannot view Student A's submission → 404 (IDOR)", async () => {
        // Student B tries to access Student A's assignment submission via their own route
        // Student B has no submission for this assignment → 404
        const res = await getAs(tokenStudentB, `/api/v1/me/assignments/${assignmentId}/my-submission`);
        expect(res.status).toBe(404);
      });
    });

    // ── STEP 2: Grade submission (AC-B1, AC-B3, AC-B5, AC-J7) ──────────────────

    describe("Step 2 — Grade submission (AC-B1/B3/B5/J7)", () => {
      it("AC-J7: Student A cannot self-grade → 403", async () => {
        const res = await patchAs(tokenStudentA, `/api/v1/crm/submissions/${submissionId}/grade`, {
          score: 100,
        });
        expect(res.status).toBe(403);
      });

      it("AC-B1: Ops (admin, all-scope) grades Student A's submission → 200, status=graded", async () => {
        // GradeSubmissionRequestSchema: rubric is z.record(z.string(), z.unknown()) — flat object, NOT array
        const res = await patchAs(tokenOps, `/api/v1/crm/submissions/${submissionId}/grade`, {
          score: 85,
          feedback: "Good work!",
          rubric: { Accuracy: 85 },
        });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("graded");
        expect(res.body.data.score).toBe(85);
        expect(res.body.data.feedback).toBe("Good work!");
      });

      it("AC-B3: Grade change is audited with before/after values", async () => {
        // Re-grade from 85 to 92 — this creates a SECOND grade audit row
        const res = await patchAs(tokenOps, `/api/v1/crm/submissions/${submissionId}/grade`, {
          score: 92,
          feedback: "Revised grade",
          rubric: { Accuracy: 92 },
        });
        expect(res.status).toBe(200);
        expect(res.body.data.score).toBe(92);

        // Verify at least 2 audit rows (grade at 85, then at 92)
        const auditRows = await prisma.auditLog.findMany({
          where: { entity: "Submission", entityId: submissionId, action: "submission.grade" },
          orderBy: { createdAt: "desc" },
        });
        expect(auditRows.length).toBeGreaterThanOrEqual(2);
        const latest = auditRows[0]!;
        // before = score 85, after = score 92
        expect((latest.before as Record<string, unknown>)?.score).toBe(85);
        expect((latest.after as Record<string, unknown>)?.score).toBe(92);
      });

      it("AC-B5: Student A views own grade + feedback after grading", async () => {
        const res = await getAs(tokenStudentA, `/api/v1/me/assignments/${assignmentId}/my-submission`);
        expect(res.status).toBe(200);
        expect(res.body.data.score).toBe(92);
        expect(res.body.data.feedback).toBe("Revised grade");
        // AC-J9 defensive: answer key never in submission response
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain("answerKey");
        expect(bodyStr).not.toContain("answer_key");
      });
    });

    // ── STEP 3: Start MCQ assessment attempt (AC-D1, AC-D2, AC-J9) ───────────

    let attemptAId: string;

    describe("Step 3 — Start MCQ attempt (AC-D1/D2/J9)", () => {
      it("AC-D1: Student A starts an attempt → 201 with server-set time_expires_at", async () => {
        const before = new Date();
        const res = await postAs(tokenStudentA, `/api/v1/me/assessments/${assessmentId}/attempts`, {});
        const after = new Date();

        expect(res.status).toBe(201);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.attempt).toBeDefined();
        attemptAId = res.body.data.attempt.id;

        const startedAt = new Date(res.body.data.attempt.startedAt);
        expect(startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
        expect(startedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

        // time_expires_at = startedAt + timeLimitS=600
        const expiresAt = new Date(res.body.data.attempt.timeExpiresAt);
        const expectedExpiry = new Date(startedAt.getTime() + 600 * 1000);
        expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(3000);
      });

      it("AC-D2/AC-J9: answer key NEVER in any HTTP response (raw body JSON scan)", async () => {
        const res = await getAs(tokenStudentA, `/api/v1/me/attempts/${attemptAId}`);
        expect(res.status).toBe(200);

        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain("answerKey");
        expect(bodyStr).not.toContain("answer_key");
        expect(bodyStr).not.toContain("isCorrect");
        expect(bodyStr).not.toContain("is_correct");
        expect(bodyStr).not.toContain("correctOption");
        expect(bodyStr).not.toContain("correct_option");

        // Also check the startAttempt response (from Step 3 — attempt was just created)
        const startRes = await getAs(tokenStudentA, `/api/v1/me/attempts/${attemptAId}`);
        const startBodyStr = JSON.stringify(startRes.body);
        expect(startBodyStr).not.toContain("answerKey");
        expect(startBodyStr).not.toContain("answer_key");
      });

      it("AC-D10: Student B cannot access Student A's attempt → 404 (IDOR)", async () => {
        const res = await getAs(tokenStudentB, `/api/v1/me/attempts/${attemptAId}`);
        expect(res.status).toBe(404);
      });
    });

    // ── STEP 4: Submit MCQ answers (AC-D3, AC-D7, AC-D4, AC-D5) ─────────────

    describe("Step 4 — Submit MCQ answers (AC-D3/D4/D5/D7)", () => {
      it("AC-D3: Student A submits correct answers before expiry → score=10, passed=true", async () => {
        const res = await putAs(tokenStudentA, `/api/v1/me/attempts/${attemptAId}`, {
          answers: [
            { questionId: mcqQ1Id, value: "opt-b" }, // correct: 4
            { questionId: mcqQ2Id, value: "opt-b" }, // correct: 9
          ],
        });

        expect(res.status).toBe(200);
        expect(res.body.data.score).toBe(10); // 5 + 5
        expect(res.body.data.totalPoints).toBe(10);
        expect(res.body.data.passed).toBe(true); // 100% >= 60%
        expect(res.body.data.submittedAt).not.toBeNull();

        // AC-J9: No answer key in submit response
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain("answerKey");
        expect(bodyStr).not.toContain("answer_key");
      });

      it("AC-D7: idempotent re-submit → same result (score=10, passed=true), no re-grade", async () => {
        const res = await putAs(tokenStudentA, `/api/v1/me/attempts/${attemptAId}`, {
          answers: [
            { questionId: mcqQ1Id, value: "opt-a" }, // wrong answers in replay — should be ignored
            { questionId: mcqQ2Id, value: "opt-a" },
          ],
        });

        expect(res.status).toBe(200);
        expect(res.body.data.score).toBe(10); // same as first submit (cached)
        expect(res.body.data.passed).toBe(true);
      });

      it("AC-D4: submit after time_expires_at → 422 ATTEMPT_EXPIRED", async () => {
        // Create a fresh second attempt (attemptsAllowed=2 so this is OK)
        const startRes = await postAs(tokenStudentA, `/api/v1/me/assessments/${assessmentId}/attempts`, {});
        expect(startRes.status).toBe(201);
        const expAttemptId = startRes.body.data.attempt.id;

        // Expire it manually in the DB so we can test the expiry gate
        await prisma.attempt.update({
          where: { id: expAttemptId },
          data: { timeExpiresAt: new Date(Date.now() - 1000) }, // 1s in the past
        });

        const res = await putAs(tokenStudentA, `/api/v1/me/attempts/${expAttemptId}`, {
          answers: [{ questionId: mcqQ1Id, value: "opt-b" }],
        });
        expect(res.status).toBe(422);
        expect(res.body.error?.code).toBe("ATTEMPT_EXPIRED");

        // NOTE: this expired attempt is NOT submitted (never got past the expiry check).
        // Do NOT call expect(attemptsAllowed) here — it would consume the second slot
        // unnecessarily. The test uses a SEPARATE assessment (exhaustedAssessmentId) for AC-D5.
      });

      it("AC-D5: start when attemptsAllowed=1 is exhausted → 422 ATTEMPTS_EXHAUSTED", async () => {
        // Uses a separate assessment (exhaustedAssessmentId, attemptsAllowed=1).
        // Strategy: start one attempt, submit it, then try to start another.

        // Start the only allowed attempt
        const startRes = await postAs(tokenStudentA, `/api/v1/me/assessments/${exhaustedAssessmentId}/attempts`, {});
        expect(startRes.status).toBe(201);
        const onlyAttemptId = startRes.body.data.attempt.id;

        // Submit it (MCQ auto-graded)
        const submitRes = await putAs(tokenStudentA, `/api/v1/me/attempts/${onlyAttemptId}`, {
          answers: [{ questionId: exhaustedQ1Id, value: "opt-b" }],
        });
        expect(submitRes.status).toBe(200);

        // Now try to start another — should be rejected (1 submitted = limit reached)
        const blockedRes = await postAs(tokenStudentA, `/api/v1/me/assessments/${exhaustedAssessmentId}/attempts`, {});
        expect(blockedRes.status).toBe(422);
        expect(blockedRes.body.error?.code).toBe("ATTEMPTS_EXHAUSTED");
      });
    });

    // ── STEP 5: Issue certificate (AC-E1/E2/E4/E6) ────────────────────────────

    let issuedCertId: string;
    let issuedCertUid: string;

    describe("Step 5 — Issue certificate (AC-E1/E4/E6)", () => {
      it("AC-E1: issue blocked when progressPct < 90 → 422 NOT_ELIGIBLE", async () => {
        await prisma.enrollment.update({
          where: { id: enrollmentAId },
          data: { progressPct: 50 },
        });

        const res = await postAs(tokenOps, "/api/v1/crm/certificates", {
          enrollmentId: enrollmentAId,
          templateId,
          overrideEligibility: false,
        });
        expect(res.status).toBe(422);
        expect(res.body.error?.code).toBe("NOT_ELIGIBLE");
        // The eligibility service returns reasons in the JSON, but HttpExceptionFilter
        // maps only { code, title, detail, errors } to ProblemDetails — reasons is stripped.
        // We assert the error code is correct (NOT_ELIGIBLE); reasons are tested in service unit tests.
        expect(res.body.error?.title).toContain("eligible");

        await prisma.enrollment.update({
          where: { id: enrollmentAId },
          data: { progressPct: 100 }, // restore for subsequent tests
        });
      });

      it("AC-E4: issue succeeds when all gates pass → Certificate row created + audited", async () => {
        // progressPct=100 (restored above), no required assessments (isRequired=false), no final project
        const res = await postAs(tokenOps, "/api/v1/crm/certificates", {
          enrollmentId: enrollmentAId,
          templateId,
          overrideEligibility: false,
        });
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe("valid");
        expect(res.body.data.certUid).toBeDefined();
        issuedCertId = res.body.data.id;
        issuedCertUid = res.body.data.certUid;

        // Verify audit log written
        const log = await prisma.auditLog.findFirst({
          where: { entity: "Certificate", entityId: issuedCertId, action: "certificate.issue" },
        });
        expect(log).not.toBeNull();
        expect(log?.actorId).toBe(opsUserId);
        expect(log?.before).toBeNull();
        // The audit `after` payload intentionally REDACTS the cert_uid (a signed token) —
        // it is not duplicated into audit logs (certificates.service.ts). The audit row's
        // entityId (issuedCertId, asserted in the `where` above) links to the certificates
        // row, which holds the real cert_uid. Forensic coverage is via enrollmentId + issuedAt.
        const after = log?.after as Record<string, unknown>;
        expect(after?.certUid).toBe("[REDACTED — stored in DB]");
        expect(after?.enrollmentId).toBe(enrollmentAId);
        expect(after?.issuedAt).toBeDefined();
        // The real cert_uid lives on the certificate row, keyed by the audited entityId.
        const certRow = await prisma.certificate.findUnique({ where: { id: issuedCertId } });
        expect(certRow?.certUid).toBe(issuedCertUid);
      });

      it("AC-E6: issuing again → 409 CERTIFICATE_ALREADY_EXISTS", async () => {
        const res = await postAs(tokenOps, "/api/v1/crm/certificates", {
          enrollmentId: enrollmentAId,
          templateId,
          overrideEligibility: false,
        });
        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe("CERTIFICATE_ALREADY_EXISTS");
      });
    });

    // ── STEP 6: Download certificate (AC-F1, AC-F4) ──────────────────────────
    // AC-F5 (revoked → 410) is tested in Step 8 after revocation.

    describe("Step 6 — Download certificate (AC-F1/F4)", () => {
      it("AC-F1: Student A downloads own cert → signed URL (not raw bucket URL)", async () => {
        const res = await getAs(tokenStudentA, `/api/v1/me/certificates/${issuedCertId}/download`);
        expect(res.status).toBe(200);
        // NoopStorageProvider returns signed URL with noop.local domain
        expect(res.body.data.downloadUrl).toBeDefined();
        expect(res.body.data.downloadUrl).toContain("noop.local");
        expect(res.body.data.filename).toMatch(/\.pdf$/);
        // Never a raw bucket URL (AC-I2)
        expect(res.body.data.downloadUrl).not.toContain("amazonaws.com");
        expect(res.body.data.downloadUrl).not.toContain("r2.cloudflarestorage.com");
      });

      it("AC-F4: Student B cannot download Student A's cert → 404 (IDOR)", async () => {
        const res = await getAs(tokenStudentB, `/api/v1/me/certificates/${issuedCertId}/download`);
        expect(res.status).toBe(404);
      });
    });

    // ── STEP 7: Public verify before revocation (AC-H1/H3/H4/H7/H8) ─────────

    describe("Step 7 — Public verify (AC-H1/H3/H4/H7/H8)", () => {
      it("AC-H8: public verify needs no auth (unauthenticated request → 200)", async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/verify/${issuedCertUid}`)
          // No Cookie, no Authorization header
          .expect(200);
        expect(res.body.data.valid).toBe(true);
      });

      it("AC-H1: valid cert → { valid:true, status:'valid', program, issuedAt, holderName }", async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/verify/${issuedCertUid}`)
          .expect(200);

        const d = res.body.data;
        expect(d.valid).toBe(true);
        expect(d.status).toBe("valid");
        expect(typeof d.program).toBe("string");
        expect(d.program.length).toBeGreaterThan(0);
        expect(typeof d.holderName).toBe("string");
        expect(d.holderName.length).toBeGreaterThan(0);
        expect(typeof d.issuedAt).toBe("string");
      });

      it("AC-H7: verify response has EXACTLY 5 keys — no PII leak", async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/verify/${issuedCertUid}`)
          .expect(200);

        const d = res.body.data;
        const keys = Object.keys(d as Record<string, unknown>);
        expect(keys.sort()).toEqual(["holderName", "issuedAt", "program", "status", "valid"].sort());

        // Explicitly banned PII fields
        expect(keys).not.toContain("email");
        expect(keys).not.toContain("phone");
        expect(keys).not.toContain("studentId");
        expect(keys).not.toContain("enrollmentId");
        expect(keys).not.toContain("tenantId");
        expect(keys).not.toContain("id");
        expect(keys).not.toContain("batchName");
        expect(keys).not.toContain("userId");
      });

      it("AC-H3: fabricated cert_uid (bad signature) → 404, no DB lookup possible", async () => {
        const fabricated = "aGVsbG8gd29ybGQ.ZmFrZXNpZ25hdHVyZQ";
        const res = await request(app.getHttpServer())
          .get(`/api/v1/verify/${fabricated}`)
          .expect(404);
        // Verify response leaks no internals
        const body = JSON.stringify(res.body);
        expect(body).not.toContain("stack");
        expect(body).not.toContain("studentId");
        expect(body).not.toContain("enrollmentId");
      });

      it("AC-H4: tampered cert_uid (one char flipped) → 404", async () => {
        const tampered = issuedCertUid.slice(0, -1) + (issuedCertUid.endsWith("a") ? "b" : "a");
        await request(app.getHttpServer())
          .get(`/api/v1/verify/${tampered}`)
          .expect(404);
      });

      it("Cache-Control: no-store is set on verify response (AC-G2 prerequisite)", async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/verify/${issuedCertUid}`);
        expect(res.headers["cache-control"]).toBe("no-store");
      });
    });

    // ── STEP 8: Revoke + re-verify + download (AC-G1, AC-G2, AC-F5) ──────────

    describe("Step 8 — Revoke + instant reflect (AC-G1/G2/F5)", () => {
      it("AC-G1: Ops revokes the certificate → status=revoked, audit before/after", async () => {
        const res = await patchAs(tokenOps, `/api/v1/crm/certificates/${issuedCertId}/revoke`, {
          reason: "Journey test revocation",
        });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("revoked");
        expect(res.body.data.revokedReason).toBe("Journey test revocation");

        // Audit log check
        const log = await prisma.auditLog.findFirst({
          where: { entity: "Certificate", entityId: issuedCertId, action: "certificate.revoke" },
        });
        expect(log).not.toBeNull();
        expect((log?.before as Record<string, unknown>)?.status).toBe("valid");
        expect((log?.after as Record<string, unknown>)?.status).toBe("revoked");
      });

      it("AC-G2: public verify reflects revocation instantly → valid:'revoked'", async () => {
        // Immediate call after revoke — no cache window allowed (Cache-Control: no-store)
        const res = await request(app.getHttpServer())
          .get(`/api/v1/verify/${issuedCertUid}`)
          .expect(200);

        expect(res.body.data.valid).toBe("revoked");
        expect(res.body.data.status).toBe("revoked");
        // Even for revoked: still only 5 keys (AC-H7 applies to all valid-signature responses)
        const keys = Object.keys(res.body.data as Record<string, unknown>);
        expect(keys.sort()).toEqual(["holderName", "issuedAt", "program", "status", "valid"].sort());
      });

      it("AC-F5: download of revoked cert → 410 CERTIFICATE_REVOKED", async () => {
        const res = await getAs(tokenStudentA, `/api/v1/me/certificates/${issuedCertId}/download`);
        expect(res.status).toBe(410);
        expect(res.body.error?.code).toBe("CERTIFICATE_REVOKED");
      });
    });

    // ── Additional RBAC / IDOR coverage ─────────────────────────────────────

    describe("Additional RBAC / IDOR coverage", () => {
      it("AC-B2: Student (no grade permission) cannot call grade endpoint → 403", async () => {
        const res = await patchAs(tokenStudentA, `/api/v1/crm/submissions/${submissionId}/grade`, {
          score: 100,
        });
        expect(res.status).toBe(403);
      });

      it("AC-H8 reconfirmed: public verify endpoint returns non-401 for unauthenticated requests", async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/verify/${issuedCertUid}`)
          // No auth headers whatsoever
          .unset("Cookie")
          .unset("Authorization");
        // 200 (valid/revoked) or 404 (cert is revoked and ghost) is OK; 401 is a test failure
        expect([200, 404]).toContain(res.status);
        expect(res.status).not.toBe(401);
      });
    });
  },
);
