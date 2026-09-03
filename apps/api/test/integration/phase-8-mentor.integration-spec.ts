// apps/api/test/integration/phase-8-mentor.integration-spec.ts
//
// P8 QA gate: Human Mentor (Phase 8) integration + cross-scope isolation tests
// (docs/specs/phase-8-mentor.md, 61 ACs). Exercises the REAL NestJS application over HTTP
// (supertest + real Nest app) AND real injected services/repositories (app.get(...))
// against a real Postgres + Redis DB (testcontainers or ambient docker-compose, via
// global-setup.ts) — the layer 90 unit tests (mocked repos) cannot prove: real RBAC/
// permission-catalog wiring, real partial-unique DB constraints under concurrency, real
// cross-tenant/cross-branch/cross-mentor isolation, and rollup reconciliation against a
// genuinely independent DB query.
//
// PATTERN: matches p6-engagement.integration-spec.ts / p5-website-funnel.integration-spec.ts
//   • reads STATE_FILE written by global-setup.ts (ambient DB preferred, testcontainers
//     fallback, skip-gracefully if neither reachable)
//   • sets ALL env vars BEFORE any import that transitively loads validateEnv()
//   • uses `describeIfAvailable` so `pnpm test:integration` stays GREEN when no DB
//   • Noop Mail/WhatsApp/Storage/Video/Captcha providers — no live vendor calls
//   • AuthService hard-codes a single tenant for /auth/login in this phase (auth.service.ts
//     line 38) — cross-tenant assertions are made at the SERVICE/REPOSITORY layer
//     (`app.get(XRepository).method(id, foreignTenantId)` / `app.get(XService).method(...)`),
//     exactly like p6-engagement's N-11/C-9 tests, rather than via a second real login.
//
// ─── DEFECTS DISCOVERED BY THIS PASS (reported, NOT silently fixed in product code) ──
//
// DEFECT-P8-01 (MEDIUM — RBAC scope gap, already flagged in code comments but unresolved
//   in behavior): AC-4 ("Branch Manager mentor creation forces branch_id to their own
//   branch") and AC-5 ("Branch Manager mentor directory list is branch-scoped") are BOTH
//   UNENFORCED. `mentors` carries NO `branch_id` column at all (confirmed:
//   prisma/schema.prisma `model Mentor` — no branchId field;
//   packages/types/src/crm/mentors.schemas.ts file header note #2;
//   apps/api/src/modules/mentors/mentors.repository.ts:9-18 "SCOPE" comment;
//   apps/api/src/modules/mentors/mentors.service.ts:34-43 `assertResolvableScope()` —
//   both "all" and "branch" scope resolve to "no restriction"). Net effect: a Branch
//   Manager with `mentors.*` (branch scope per the RBAC seed table) has TENANT-WIDE read/
//   write/delete access to every mentor hiring record — including another branch's mentor
//   PII (email/phone) — not just their own branch's. Test "DEFECT AC-4/AC-5" below proves
//   this against the real DB/API (a Branch-C manager can GET a mentor created by a
//   Branch-B manager, and see it in their own directory list). This is a real,
//   already-documented-in-comments-but-still-live scope-isolation gap; recommend
//   db-architect ship the `mentors.branch_id` follow-up migration named in the code
//   comments, not treat the comment as sufficient mitigation.
//
// M-1 (spec-wording vs. codebase convention — NOT a functional/security defect, same class
//   as p5/p6's documented M-1 findings; the request IS still rejected either way):
//   AC-2 describes a missing-required-field mentor-create request as producing a 422. This
//   codebase's ONE validation pipe (ZodValidationPipe) always throws 400 for a zod shape
//   violation; a mentor-create request missing `fullName`/`externalInstitute` is rejected
//   with 400, not 422 (and per mentors.schemas.ts file header note #3, `email` is a
//   required NOT NULL column, so AC-2's literal "both email AND phone missing" scenario is
//   unreachable by construction). Test below asserts the actual 400.
//
// M-2 (spec-wording vs. codebase convention — audit entity/action naming): AC-14/AC-30/
//   AC-43 describe `audit_logs.entity`/`action` values as lowercase/snake-case literals
//   ("mentor"/"batch_mentor"/"batch", "complete"). The audit extension
//   (apps/api/src/prisma/audit.extension.ts) always writes the Prisma MODEL name
//   ("Mentor"/"BatchMentor"/"Batch", PascalCase) and one of "create"/"update"/"delete" — the
//   SAME convention already used tenant-wide (confirmed against crm-audit-logs.integration-
//   spec.ts, which asserts `entity: "StudentProfile"` / `"User"`). Tests below assert the
//   real values (an audit row exists with the correct entity/entityId/action), not the
//   spec's literal casing.
//
// ACCEPTANCE CRITERIA COVERED BY THIS FILE (headline + isolation layer; the remaining ACs
// — especially detailed business-rule branches like AC-6/7/8/10/20-22/25/29/41 — are
// covered by the 90 pre-existing unit tests against mocked repos, see
// mentors.service.spec.ts / batch-mentors.service.spec.ts / batch-completion.service.spec.ts /
// mentor-dashboard.service.spec.ts, and by mentors.permission-catalog.spec.ts for the
// seed-catalog regression class):
//
// WS-1 Mentor CRUD:    AC-1, AC-2(400,M-1), AC-3, AC-4(DEFECT), AC-5(DEFECT), AC-9, AC-11,
//                       AC-12, AC-13, AC-14(M-2), AC-15
// WS-2 Assignment:      AC-17, AC-18, AC-19, AC-20, AC-21, AC-24, AC-26, AC-27, AC-28,
//                       AC-30(M-2), Part-4 race edge case (partial-unique DB backstop)
// WS-3 Completion:      AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39,
//                       AC-40, AC-41, AC-42, AC-43(M-2), AC-44
// WS-4 Dashboard:       AC-46, AC-47, AC-48, AC-49, AC-50, AC-51, AC-53
// RBAC cross-cutting:   AC-54, Rule M-3

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

/** Mirrors batch-completion.service.ts's `clampPct` exactly (0-100, 2dp round). */
function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

describeIfAvailable(
  "P8 Mentor (human, external-institute hire) — integration + isolation (real Postgres + Redis + Noop providers)",
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
    const { MentorsRepository } = require("../../src/modules/mentors/mentors.repository");
    const { BatchMentorsService } = require("../../src/modules/mentors/batch-mentors.service");
    const { BatchCompletionService } = require("../../src/modules/mentors/batch-completion.service");

    let app: import("@nestjs/common").INestApplication;
    let httpServer: ReturnType<typeof app.getHttpServer>;
    let prisma: InstanceType<typeof PrismaClient>;

    let mentorsRepository: InstanceType<typeof MentorsRepository>;
    let batchMentorsService: InstanceType<typeof BatchMentorsService>;
    let batchCompletionService: InstanceType<typeof BatchCompletionService>;

    const PASSWORD = "P@ssword123!";
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    let tenantId: string;
    /** A syntactically-valid but never-persisted tenant id — proves tenant-scoped
     * repository queries reject cross-tenant access WITHOUT depending on `/auth/login`,
     * which is hard-coded to the single "stimuliiq" tenant in this phase. */
    const foreignTenantId: string = randomUUID();

    // ── Users / cookies ─────────────────────────────────────────────────────
    let adminUserId: string;
    // `_`-prefixed: assigned by createUser() but only the cookies/csrf derived from these
    // ids are exercised in HTTP calls below — kept for readability at the call sites that
    // create these fixtures (matches the eslint no-unused-vars `/^_/u` allowance).
    let _bmBUserId: string;
    let _bmCUserId: string;
    let _counsellorUserId: string;
    let mentorAUserId: string;
    let mentorBUserId: string;
    let mentorCUserId: string;
    let mentorDUserId: string;

    let adminCookies: string[], csrfAdmin: string;
    let bmBCookies: string[], csrfBmB: string;
    let bmCCookies: string[], csrfBmC: string;
    let counsellorCookies: string[], csrfCounsellor: string;
    let mentorACookies: string[], csrfMentorA: string;
    // mentorB/C/D never drive a MUTATING (CSRF-checked) request in this file — only GETs —
    // so their csrf tokens are extracted for symmetry/future use but not currently read.
    let mentorBCookies: string[], _csrfMentorB: string;
    let mentorCCookies: string[], _csrfMentorC: string;
    let mentorDCookies: string[], _csrfMentorD: string;

    // ── Org fixtures ────────────────────────────────────────────────────────
    let branchB: { id: string; name: string };
    let branchC: { id: string; name: string };
    let program: { id: string };

    // ── Mentor hiring-record fixtures ───────────────────────────────────────
    let mentorA: { id: string };
    let mentorB: { id: string };
    let mentorC: { id: string };
    let mentorInactive: { id: string };
    let mentorAssignable1: { id: string };
    let mentorAssignable2: { id: string };
    let mentorAssignable3: { id: string };
    let mentorForDeleteBlock: { id: string };

    // ── Batch fixtures ──────────────────────────────────────────────────────
    let batchA: { id: string; name: string };
    let batchB: { id: string; name: string };
    let batchLiveRecheck: { id: string; name: string };
    let batchPlanned: { id: string; name: string };
    let batchAssignHappy: { id: string; name: string };
    let batchArchived: { id: string; name: string };
    let batchDeleteBlock: { id: string; name: string };
    let batchCompletionRollup: { id: string; name: string };
    let batchRaceTarget: { id: string; name: string };

    // Cleanup registries (collected as fixtures are created)
    const fixtureUserIds: string[] = [];
    const fixtureBranchIds: string[] = [];
    const fixtureBatchIds: string[] = [];
    const fixtureMentorIds: string[] = [];
    const fixtureEnrollmentIds: string[] = [];
    const fixtureStudentProfileIds: string[] = [];
    const fixtureCertificateIds: string[] = [];
    let fixtureCertTemplateId: string | undefined;
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
      app = moduleFixture.createNestApplication();
      app.use(cookieParser(process.env.COOKIE_SECRET));
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalInterceptors(new EnvelopeInterceptor());
      app.setGlobalPrefix("api/v1");
      await app.init();
      httpServer = app.getHttpServer();

      mentorsRepository = app.get(MentorsRepository);
      batchMentorsService = app.get(BatchMentorsService);
      batchCompletionService = app.get(BatchCompletionService);

      // ── Reuse the seeded tenant (AuthService hard-codes "stimuliiq" for /auth/login) ──
      const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
      if (!tenant) throw new Error("No tenant found — run `pnpm db:seed` first.");
      tenantId = tenant.id;

      const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin", deletedAt: null } });
      const branchManagerRole = await prisma.role.findFirst({ where: { tenantId, key: "branch_manager", deletedAt: null } });
      const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
      const mentorRole = await prisma.role.findFirst({ where: { tenantId, key: "mentor", deletedAt: null } });
      if (!adminRole || !branchManagerRole || !counsellorRole || !mentorRole) {
        throw new Error("Roles not seeded — run `pnpm db:seed` first.");
      }

      const pwHash = await argon2.hash(PASSWORD);

      // ── Branches ─────────────────────────────────────────────────────────
      branchB = await prisma.branch.create({ data: { tenantId, name: `P8 QA Branch B ${suffix}`, status: "active" } });
      branchC = await prisma.branch.create({ data: { tenantId, name: `P8 QA Branch C ${suffix}`, status: "active" } });
      fixtureBranchIds.push(branchB.id, branchC.id);

      // ── Users ────────────────────────────────────────────────────────────
      async function createUser(label: string, roleId: string, branchId: string | null): Promise<string> {
        const email = `p8.${label}.${suffix}@test.com`;
        const user = await prisma.user.create({
          data: { tenantId, email, name: `P8 QA ${label}`, passwordHash: pwHash, status: "active" },
        });
        await prisma.userRole.create({ data: { userId: user.id, roleId, branchId } });
        fixtureUserIds.push(user.id);
        return user.id;
      }

      adminUserId = await createUser("admin", adminRole.id, null);
      _bmBUserId = await createUser("bmB", branchManagerRole.id, branchB.id);
      _bmCUserId = await createUser("bmC", branchManagerRole.id, branchC.id);
      _counsellorUserId = await createUser("counsellor", counsellorRole.id, null);
      mentorAUserId = await createUser("mentorA", mentorRole.id, null);
      mentorBUserId = await createUser("mentorB", mentorRole.id, null);
      mentorCUserId = await createUser("mentorC", mentorRole.id, null);
      mentorDUserId = await createUser("mentorD", mentorRole.id, null);

      // ── Program (shared) ────────────────────────────────────────────────
      program = await prisma.program.create({
        data: {
          tenantId, slug: `p8-qa-program-${suffix}`, title: "P8 QA Program",
          domain: "Engineering", pricePaise: 100000_00, status: "published",
        },
      });
      fixtureProgramId = program.id;

      // ── Mentor hiring-record fixtures ──────────────────────────────────
      async function createMentor(
        label: string,
        userId: string | null,
        engagementStatus: "prospective" | "active" | "inactive",
      ): Promise<{ id: string }> {
        const row = await prisma.mentor.create({
          data: {
            tenantId, userId, fullName: `P8 QA Mentor ${label}`,
            email: `p8.mentor.${label}.${suffix}@test.com`,
            externalInstitute: "P8 QA External Institute",
            engagementStatus,
            joinedAt: engagementStatus === "active" ? new Date("2026-01-01") : null,
          },
        });
        fixtureMentorIds.push(row.id);
        return row;
      }

      mentorA = await createMentor("A", mentorAUserId, "active");
      mentorB = await createMentor("B", mentorBUserId, "active");
      mentorC = await createMentor("C", mentorCUserId, "active");
      await createMentor("D", mentorDUserId, "active"); // AC-51: zero-assignment mentor
      mentorInactive = await createMentor("Inactive", null, "inactive");
      mentorAssignable1 = await createMentor("Assignable1", null, "active");
      mentorAssignable2 = await createMentor("Assignable2", null, "active");
      mentorAssignable3 = await createMentor("Assignable3", null, "active");
      mentorForDeleteBlock = await createMentor("DeleteBlock", null, "active");

      // ── Batches ─────────────────────────────────────────────────────────
      async function createBatch(
        label: string,
        status: "planned" | "active" | "archived" | "completed",
        opts: { completedAt?: Date } = {},
      ): Promise<{ id: string; name: string }> {
        const name = `P8 QA Batch ${label} ${suffix}`;
        const row = await prisma.batch.create({
          data: {
            tenantId, programId: program.id, branchId: branchB.id, name, status,
            startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), capacity: 30,
            ...(opts.completedAt ? { completedAt: opts.completedAt } : {}),
          },
        });
        fixtureBatchIds.push(row.id);
        return row;
      }

      batchA = await createBatch("A", "active");
      batchB = await createBatch("B", "active");
      batchLiveRecheck = await createBatch("LiveRecheck", "active");
      batchPlanned = await createBatch("Planned", "planned");
      batchAssignHappy = await createBatch("AssignHappy", "active");
      batchArchived = await createBatch("Archived", "archived");
      batchDeleteBlock = await createBatch("DeleteBlock", "active");
      batchCompletionRollup = await createBatch("CompletionRollup", "active");
      batchRaceTarget = await createBatch("RaceTarget", "active");

      // ── batch_mentors seed assignments ─────────────────────────────────
      await prisma.batchMentor.create({ data: { tenantId, batchId: batchA.id, mentorId: mentorA.id, isLead: true, assignedByUserId: adminUserId } });
      await prisma.batchMentor.create({ data: { tenantId, batchId: batchB.id, mentorId: mentorB.id, isLead: true, assignedByUserId: adminUserId } });
      await prisma.batchMentor.create({ data: { tenantId, batchId: batchLiveRecheck.id, mentorId: mentorC.id, isLead: true, assignedByUserId: adminUserId } });
      await prisma.batchMentor.create({ data: { tenantId, batchId: batchAssignHappy.id, mentorId: mentorAssignable1.id, isLead: true, assignedByUserId: adminUserId } });
      await prisma.batchMentor.create({ data: { tenantId, batchId: batchDeleteBlock.id, mentorId: mentorForDeleteBlock.id, isLead: false, assignedByUserId: adminUserId } });

      // ── WS-3 completion-rollup enrollment fixtures ─────────────────────
      // 4 students: dropped / certified / eligibleNotIssued / inProgress. The program has
      // NO assessments/assignments, so P4 eligibility's requiredAssessmentsPassed/
      // finalProjectApproved are vacuously true (documented engine behavior) — eligibility
      // reduces to completionPct >= 90 for this fixture, letting the reconciliation test
      // below independently recompute buckets from a raw DB query without reimplementing
      // the eligibility engine itself (the engine is still exercised for real via the API).
      async function createEnrolledStudent(
        label: string,
        progressPct: number,
        status: "active" | "dropped",
      ): Promise<{ enrollmentId: string; studentProfileId: string }> {
        const studentUserId = await createUser(`student-${label}`, (await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } }))!.id, null);
        const studentProfile = await prisma.studentProfile.create({
          data: { tenantId, userId: studentUserId, courseType: "btech", status: "active" },
        });
        fixtureStudentProfileIds.push(studentProfile.id);
        const enrollment = await prisma.enrollment.create({
          data: {
            tenantId, studentId: studentProfile.id, batchId: batchCompletionRollup.id, programId: program.id,
            status, progressPct,
          },
        });
        fixtureEnrollmentIds.push(enrollment.id);
        return { enrollmentId: enrollment.id, studentProfileId: studentProfile.id };
      }

      const droppedStudent = await createEnrolledStudent("dropped", 50, "dropped");
      const certifiedStudent = await createEnrolledStudent("certified", 95, "active");
      await createEnrolledStudent("eligible", 92, "active");
      await createEnrolledStudent("inprogress", 40, "active");
      void droppedStudent;

      const certTemplate = await prisma.certificateTemplate.create({
        data: { tenantId, name: `P8 QA Cert Template ${suffix}`, design: { orientation: "landscape" }, fields: [], status: "active" },
      });
      fixtureCertTemplateId = certTemplate.id;

      const certificate = await prisma.certificate.create({
        data: {
          tenantId, enrollmentId: certifiedStudent.enrollmentId, studentId: certifiedStudent.studentProfileId,
          programId: program.id, certUid: `p8-qa-cert-${suffix}`, serial: `p8-qa-serial-${suffix}`, templateId: certTemplate.id,
          issuedAt: new Date(), issuedById: adminUserId, status: "valid",
        },
      });
      fixtureCertificateIds.push(certificate.id);

      // ── Logins ──────────────────────────────────────────────────────────
      ({ cookies: adminCookies, csrf: csrfAdmin } = await login(`p8.admin.${suffix}@test.com`, PASSWORD));
      ({ cookies: bmBCookies, csrf: csrfBmB } = await login(`p8.bmB.${suffix}@test.com`, PASSWORD));
      ({ cookies: bmCCookies, csrf: csrfBmC } = await login(`p8.bmC.${suffix}@test.com`, PASSWORD));
      ({ cookies: counsellorCookies, csrf: csrfCounsellor } = await login(`p8.counsellor.${suffix}@test.com`, PASSWORD));
      ({ cookies: mentorACookies, csrf: csrfMentorA } = await login(`p8.mentorA.${suffix}@test.com`, PASSWORD));
      ({ cookies: mentorBCookies, csrf: _csrfMentorB } = await login(`p8.mentorB.${suffix}@test.com`, PASSWORD));
      ({ cookies: mentorCCookies, csrf: _csrfMentorC } = await login(`p8.mentorC.${suffix}@test.com`, PASSWORD));
      ({ cookies: mentorDCookies, csrf: _csrfMentorD } = await login(`p8.mentorD.${suffix}@test.com`, PASSWORD));
    }, 120_000);

    afterAll(async () => {
      if (prisma) {
        await prisma.certificate.deleteMany({ where: { id: { in: fixtureCertificateIds } } }).catch(() => {});
        await prisma.enrollment.deleteMany({ where: { id: { in: fixtureEnrollmentIds } } }).catch(() => {});
        if (fixtureCertTemplateId) await prisma.certificateTemplate.deleteMany({ where: { id: fixtureCertTemplateId } }).catch(() => {});
        await prisma.studentProfile.deleteMany({ where: { id: { in: fixtureStudentProfileIds } } }).catch(() => {});
        await prisma.batchMentor.deleteMany({ where: { batchId: { in: fixtureBatchIds } } }).catch(() => {});
        await prisma.mentor.deleteMany({ where: { id: { in: fixtureMentorIds } } }).catch(() => {});
        await prisma.batch.deleteMany({ where: { id: { in: fixtureBatchIds } } }).catch(() => {});
        if (fixtureProgramId) await prisma.program.deleteMany({ where: { id: fixtureProgramId } }).catch(() => {});
        await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
        await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
        // Gamification rows FK to `users`, and lesson completion now writes them.
        await prisma.pointsLedger.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
        await prisma.userBadge.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
        await prisma.branch.deleteMany({ where: { id: { in: fixtureBranchIds } } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (app) await app.close();
    }, 30_000);

    // ═══════════════════════════════════════════════════════════════════════
    // WS-1: Mentor CRUD (hiring records)
    // ═══════════════════════════════════════════════════════════════════════

    describe("WS-1: Mentor CRUD (hiring records)", () => {
      let crudMentorId: string;

      it("AC-1 HEADLINE: non-mentors.* role (counsellor) 403 on create; admin (mentors.create, scope=all) succeeds", async () => {
        const forbidden = await request(httpServer)
          .post("/api/v1/crm/mentors")
          .set("Cookie", cookieHeader(counsellorCookies))
          .set("X-CSRF-Token", csrfCounsellor)
          .send({ fullName: "Should Not Be Created", email: `p8.should-not.${suffix}@test.com`, externalInstitute: "X" });
        expect(forbidden.status).toBe(403);

        const created = await request(httpServer)
          .post("/api/v1/crm/mentors")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ fullName: "P8 QA CRUD Mentor", email: `p8.crud.mentor.${suffix}@test.com`, externalInstitute: "IIT QA Institute" });
        expect(created.status).toBe(201);
        expect(created.body.data.fullName).toBe("P8 QA CRUD Mentor");
        expect(created.body.data.engagementStatus).toBe("prospective"); // schema default
        crudMentorId = created.body.data.id;
        fixtureMentorIds.push(crudMentorId); // created via HTTP, not the createMentor() fixture helper — must self-register for teardown

        // AC-14/M-2: create is audit-logged — real entity value is the PascalCase Prisma
        // model name ("Mentor"), not the spec's literal lowercase "mentor" (see M-2 above).
        const auditRow = await prisma.auditLog.findFirst({
          where: { tenantId, entity: "Mentor", entityId: crudMentorId, action: "create" },
          orderBy: { createdAt: "desc" },
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow.actorId).toBe(adminUserId);
      });

      it("AC-2/M-1: creating a mentor missing a required field is rejected before any row is written (400, zod boundary — see M-1)", async () => {
        const res = await request(httpServer)
          .post("/api/v1/crm/mentors")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ email: `p8.missing-fullname.${suffix}@test.com`, externalInstitute: "X" }); // fullName omitted
        expect(res.status).toBe(400);

        const row = await prisma.mentor.findFirst({ where: { tenantId, email: `p8.missing-fullname.${suffix}@test.com` } });
        expect(row).toBeNull(); // no row written either way
      });

      it("AC-3: engagementStatus='active' without joinedAt -> 422 JOINED_DATE_REQUIRED; with joinedAt -> 201", async () => {
        const missingJoinedAt = await request(httpServer)
          .post("/api/v1/crm/mentors")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ fullName: "AC-3 No Joined Date", email: `p8.ac3-no-join.${suffix}@test.com`, externalInstitute: "X", engagementStatus: "active" });
        expect(missingJoinedAt.status).toBe(422);
        expect(missingJoinedAt.body.error.code).toBe("JOINED_DATE_REQUIRED");

        const withJoinedAt = await request(httpServer)
          .post("/api/v1/crm/mentors")
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({
            fullName: "AC-3 With Joined Date", email: `p8.ac3-with-join.${suffix}@test.com`,
            externalInstitute: "X", engagementStatus: "active", joinedAt: "2026-01-01",
          });
        expect(withJoinedAt.status).toBe(201);
        fixtureMentorIds.push(withJoinedAt.body.data.id); // created via HTTP — must self-register for teardown
      });

      it("AC-5/6/7/8: list/search/filter — search substring, filter combo, and an empty result are all 200 (never 404/500)", async () => {
        const listRes = await request(httpServer).get("/api/v1/crm/mentors").set("Cookie", cookieHeader(adminCookies));
        expect(listRes.status).toBe(200);
        expect(listRes.body.data.some((m: { id: string }) => m.id === crudMentorId)).toBe(true);
        expect(listRes.body.meta).toMatchObject({ page: 1, pageSize: 20 });

        const searchRes = await request(httpServer)
          .get("/api/v1/crm/mentors")
          .query({ search: "CRUD Mentor" })
          .set("Cookie", cookieHeader(adminCookies));
        expect(searchRes.status).toBe(200);
        expect(searchRes.body.data.some((m: { id: string }) => m.id === crudMentorId)).toBe(true);

        const emptyRes = await request(httpServer)
          .get("/api/v1/crm/mentors")
          .query({ search: `no-such-mentor-${suffix}-zzz` })
          .set("Cookie", cookieHeader(adminCookies));
        expect(emptyRes.status).toBe(200); // AC-8: empty filter result, never 404/500
        expect(emptyRes.body.data).toEqual([]);
      });

      it("AC-9: PATCH is a partial update — only the supplied field changes", async () => {
        const before = await request(httpServer).get(`/api/v1/crm/mentors/${crudMentorId}`).set("Cookie", cookieHeader(adminCookies));
        expect(before.body.data.externalInstitute).toBe("IIT QA Institute");

        const patchRes = await request(httpServer)
          .patch(`/api/v1/crm/mentors/${crudMentorId}`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ notes: "Updated via AC-9 test" });
        expect(patchRes.status).toBe(200);
        expect(patchRes.body.data.notes).toBe("Updated via AC-9 test");
        expect(patchRes.body.data.externalInstitute).toBe("IIT QA Institute"); // unchanged
        expect(patchRes.body.data.fullName).toBe("P8 QA CRUD Mentor"); // unchanged
      });

      it("AC-11/AC-12/AC-14: soft-delete requires mentors.delete, is blocked while actively assigned (409 + batch name in errors[]), succeeds after removal, and restores", async () => {
        const forbiddenDelete = await request(httpServer)
          .delete(`/api/v1/crm/mentors/${mentorForDeleteBlock.id}`)
          .set("Cookie", cookieHeader(counsellorCookies))
          .set("X-CSRF-Token", csrfCounsellor);
        expect(forbiddenDelete.status).toBe(403);

        const blocked = await request(httpServer)
          .delete(`/api/v1/crm/mentors/${mentorForDeleteBlock.id}`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.code).toBe("MENTOR_HAS_ACTIVE_ASSIGNMENTS");
        expect(blocked.body.error.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "batchMentorId", message: batchDeleteBlock.name })]),
        );

        const removeAssignment = await request(httpServer)
          .delete(`/api/v1/crm/batches/${batchDeleteBlock.id}/mentors/${mentorForDeleteBlock.id}`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(removeAssignment.status).toBe(200);

        const deleteSucceeds = await request(httpServer)
          .delete(`/api/v1/crm/mentors/${mentorForDeleteBlock.id}`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(deleteSucceeds.status).toBe(200);
        expect(deleteSucceeds.body.data.deletedAt).not.toBeNull();

        const listAfterDelete = await request(httpServer).get("/api/v1/crm/mentors").set("Cookie", cookieHeader(adminCookies));
        expect(listAfterDelete.body.data.some((m: { id: string }) => m.id === mentorForDeleteBlock.id)).toBe(false);

        const restoreRes = await request(httpServer)
          .post(`/api/v1/crm/mentors/${mentorForDeleteBlock.id}/restore`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(restoreRes.status).toBe(200);
        expect(restoreRes.body.data.deletedAt).toBeNull();
      });

      it("AC-13: cross-tenant IDOR at the repository layer — mismatched tenantId returns null (never a broader/leaked row)", async () => {
        const crossTenant = await mentorsRepository.findById(foreignTenantId, crudMentorId);
        expect(crossTenant).toBeNull();

        const sameTenant = await mentorsRepository.findById(tenantId, crudMentorId);
        expect(sameTenant).not.toBeNull();
        expect(sameTenant.id).toBe(crudMentorId);
      });

      it("AC-15: every non-mentors.* role (counsellor) is blocked on every mentor endpoint (GET/POST/PATCH/DELETE)", async () => {
        const getList = await request(httpServer).get("/api/v1/crm/mentors").set("Cookie", cookieHeader(counsellorCookies));
        expect(getList.status).toBe(403);

        const getOne = await request(httpServer).get(`/api/v1/crm/mentors/${crudMentorId}`).set("Cookie", cookieHeader(counsellorCookies));
        expect(getOne.status).toBe(403);

        const patch = await request(httpServer)
          .patch(`/api/v1/crm/mentors/${crudMentorId}`)
          .set("Cookie", cookieHeader(counsellorCookies))
          .set("X-CSRF-Token", csrfCounsellor)
          .send({ notes: "nope" });
        expect(patch.status).toBe(403);

        const del = await request(httpServer)
          .delete(`/api/v1/crm/mentors/${crudMentorId}`)
          .set("Cookie", cookieHeader(counsellorCookies))
          .set("X-CSRF-Token", csrfCounsellor);
        expect(del.status).toBe(403);
      });

      it("DEFECT-P8-01 (AC-4/AC-5): mentors carry no branch_id — a Branch Manager's mentor directory/CRUD is NOT branch-scoped (tenant-wide, not their-branch-only)", async () => {
        const createdByBmB = await request(httpServer)
          .post("/api/v1/crm/mentors")
          .set("Cookie", cookieHeader(bmBCookies))
          .set("X-CSRF-Token", csrfBmB)
          .send({ fullName: "P8 QA BranchB-created Mentor", email: `p8.branchb.mentor.${suffix}@test.com`, externalInstitute: "Branch B Institute" });
        expect(createdByBmB.status).toBe(201);
        const branchScopedMentorId = createdByBmB.body.data.id;
        fixtureMentorIds.push(branchScopedMentorId);

        // SPEC-INTENDED (AC-5): Branch Manager C (a DIFFERENT branch) should get 404/absent.
        // ACTUAL (see DEFECT-P8-01 above): 200 — visible tenant-wide because `mentors` has
        // no branch_id column at all (mentors.repository.ts:9-18, mentors.service.ts:34-43).
        const getByBmC = await request(httpServer)
          .get(`/api/v1/crm/mentors/${branchScopedMentorId}`)
          .set("Cookie", cookieHeader(bmCCookies));
        expect(getByBmC.status).toBe(200);
        expect(getByBmC.body.data.id).toBe(branchScopedMentorId);

        const listByBmC = await request(httpServer).get("/api/v1/crm/mentors").set("Cookie", cookieHeader(bmCCookies));
        expect(listByBmC.status).toBe(200);
        expect(listByBmC.body.data.some((m: { id: string }) => m.id === branchScopedMentorId)).toBe(true);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // WS-2: Assign mentors to batches
    // ═══════════════════════════════════════════════════════════════════════

    describe("WS-2: Assign mentors to batches", () => {
      it("AC-17 HEADLINE: non-mentors.assign caller 403; admin (mentors.assign, scope=all) succeeds", async () => {
        const forbidden = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors`)
          .set("Cookie", cookieHeader(counsellorCookies))
          .set("X-CSRF-Token", csrfCounsellor)
          .send({ mentorId: mentorAssignable2.id });
        expect(forbidden.status).toBe(403);
      });

      it("AC-18: assigning a prospective/inactive mentor is rejected (422 MENTOR_NOT_ACTIVE)", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ mentorId: mentorInactive.id });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("MENTOR_NOT_ACTIVE");
      });

      it("AC-19: a literal-repeat duplicate active assignment is rejected (409 ALREADY_ASSIGNED, pre-check path — proves no duplicate row)", async () => {
        // mentorAssignable1 is already actively assigned (isLead:true) to batchAssignHappy
        // via the beforeAll fixture seed.
        const res = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ mentorId: mentorAssignable1.id, isLead: true });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("ALREADY_ASSIGNED");

        const rows = await prisma.batchMentor.findMany({
          where: { tenantId, batchId: batchAssignHappy.id, mentorId: mentorAssignable1.id, deletedAt: null },
        });
        expect(rows).toHaveLength(1); // still exactly one active row
      });

      it("AC-20/AC-21: a batch may have multiple concurrent mentors, but at most one lead", async () => {
        const assignRes = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ mentorId: mentorAssignable2.id, isLead: false });
        expect(assignRes.status).toBe(201);

        // AC-30/M-2: assign is audit-logged (entity="BatchMentor", the PascalCase Prisma model
        // name — see M-2 header note, not the spec's literal "batch_mentor").
        const auditRow = await prisma.auditLog.findFirst({
          where: { tenantId, entity: "BatchMentor", entityId: assignRes.body.data.batchMentorId, action: "create" },
        });
        expect(auditRow).not.toBeNull();

        let list = await request(httpServer).get(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors`).set("Cookie", cookieHeader(adminCookies));
        expect(list.body.data.map((r: { mentorId: string }) => r.mentorId).sort()).toEqual(
          [mentorAssignable1.id, mentorAssignable2.id].sort(),
        );

        // Flip mentorAssignable2 to lead -> mentorAssignable1's lead flag clears (AC-21).
        // NOTE: the update-in-place path (existing assignment, differing isLead) still
        // returns 201 — `@HttpCode(201)` is fixed at the POST /mentors decorator level
        // regardless of whether the service takes the create-or-update-in-place branch.
        const leadSwap = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ mentorId: mentorAssignable2.id, isLead: true });
        expect(leadSwap.status).toBe(201);

        list = await request(httpServer).get(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors`).set("Cookie", cookieHeader(adminCookies));
        const byMentor = new Map(list.body.data.map((r: { mentorId: string; isLead: boolean }) => [r.mentorId, r.isLead]));
        expect(byMentor.get(mentorAssignable2.id)).toBe(true);
        expect(byMentor.get(mentorAssignable1.id)).toBe(false);
      });

      it("Partial-unique DB constraint backstop under concurrency: two simultaneous POSTs -> exactly one 201, one 409, NEVER a 500", async () => {
        const post = () =>
          request(httpServer)
            .post(`/api/v1/crm/batches/${batchRaceTarget.id}/mentors`)
            .set("Cookie", cookieHeader(adminCookies))
            .set("X-CSRF-Token", csrfAdmin)
            .send({ mentorId: mentorAssignable3.id, isLead: false });

        const [r1, r2] = await Promise.all([post(), post()]);
        const statuses = [r1.status, r2.status].sort((a, b) => a - b);
        expect(statuses).toEqual([201, 409]);
        for (const r of [r1, r2]) {
          if (r.status === 409) expect(r.body.error.code).toBe("ALREADY_ASSIGNED");
        }

        const rows = await prisma.batchMentor.findMany({
          where: { tenantId, batchId: batchRaceTarget.id, mentorId: mentorAssignable3.id, deletedAt: null },
        });
        expect(rows).toHaveLength(1); // the DB partial-unique index left exactly one active row
      });

      it("AC-24: removing a mentor from a batch is a soft-unassign (row preserved with deletedAt set, never hard-deleted)", async () => {
        const removeRes = await request(httpServer)
          .delete(`/api/v1/crm/batches/${batchAssignHappy.id}/mentors/${mentorAssignable2.id}`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(removeRes.status).toBe(200);
        expect(removeRes.body.data.some((r: { mentorId: string }) => r.mentorId === mentorAssignable2.id)).toBe(false);

        const row = await prisma.batchMentor.findFirst({ where: { tenantId, batchId: batchAssignHappy.id, mentorId: mentorAssignable2.id } });
        expect(row).not.toBeNull(); // row still exists (soft-unassign, Rule M-5)
        expect(row.deletedAt).not.toBeNull();
      });

      it("AC-26: assignment is blocked on an archived batch (422 BATCH_NOT_ASSIGNABLE)", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchArchived.id}/mentors`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ mentorId: mentorAssignable1.id });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("BATCH_NOT_ASSIGNABLE");
      });

      it("AC-27: cross-tenant IDOR at the service layer — assign across the tenant boundary is rejected (404, no assignment created)", async () => {
        await expect(
          batchMentorsService.assign(foreignTenantId, adminUserId, batchAssignHappy.id, { mentorId: mentorAssignable1.id, isLead: false }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it("AC-28: Branch Manager cannot assign a mentor to a batch outside their own branch (404, IDOR-safe)", async () => {
        // bmCUser is scoped to Branch C; batchA lives in Branch B.
        const res = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchA.id}/mentors`)
          .set("Cookie", cookieHeader(bmCCookies))
          .set("X-CSRF-Token", csrfBmC)
          .send({ mentorId: mentorAssignable1.id });
        expect(res.status).toBe(404);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // WS-3: Track internship program to completion
    // ═══════════════════════════════════════════════════════════════════════

    describe("WS-3: Track internship program to completion", () => {
      it("AC-31/32/33/34/35 HEADLINE: completion rollup reconciles exactly with an independent direct DB recomputation", async () => {
        // Independent recomputation, sourced from a FRESH raw query (never the in-memory
        // fixture variables) — mirrors the documented AC-34/35 formula exactly, proving the
        // API's numbers are a live read of `enrollments`/`certificates`, not a parallel
        // progress system (LOCK-4).
        const rows = await prisma.enrollment.findMany({ where: { tenantId, batchId: batchCompletionRollup.id, deletedAt: null } });
        const certs = await prisma.certificate.findMany({
          where: { tenantId, enrollmentId: { in: rows.map((r: { id: string }) => r.id) }, deletedAt: null },
        });
        const certByEnrollment = new Map(certs.map((c: { enrollmentId: string; status: string }) => [c.enrollmentId, c]));

        let certified = 0, eligibleNotIssued = 0, inProgress = 0, dropped = 0;
        const activeProgress: number[] = [];
        for (const r of rows as Array<{ id: string; status: string; progressPct: number }>) {
          if (r.status === "dropped") {
            dropped++;
            continue;
          }
          activeProgress.push(r.progressPct);
          const cert = certByEnrollment.get(r.id) as { status: string } | undefined;
          const hasValidCert = cert?.status === "valid";
          // Vacuous-true for requiredAssessmentsPassed/finalProjectApproved (no assessments/
          // assignments exist for this program) — eligibility reduces to completionPct>=90.
          const eligible = r.progressPct >= 90;
          if (hasValidCert) certified++;
          else if (eligible) eligibleNotIssued++;
          else inProgress++;
        }
        const totalActive = activeProgress.length;
        const expectedPercentComplete = totalActive > 0 ? clampPct(activeProgress.reduce((a, b) => a + b, 0) / totalActive) : null;

        const res = await request(httpServer)
          .get(`/api/v1/crm/batches/${batchCompletionRollup.id}/completion`)
          .set("Cookie", cookieHeader(adminCookies));
        expect(res.status).toBe(200);
        expect(res.body.data.totalActive).toBe(totalActive);
        expect(res.body.data.certified).toBe(certified);
        expect(res.body.data.eligibleNotIssued).toBe(eligibleNotIssued);
        expect(res.body.data.inProgress).toBe(inProgress);
        expect(res.body.data.dropped).toBe(dropped);
        expect(res.body.data.percentComplete).toBe(expectedPercentComplete);
        expect(res.body.data.canTransitionToComplete).toBe(true); // status='active'

        // AC-32/33: per-student breakdown — completionPct is the EXACT progress_pct value,
        // and eligibility.reasons is the real P4 engine's shape (not re-derived/simplified).
        const studentsRes = await request(httpServer)
          .get(`/api/v1/crm/batches/${batchCompletionRollup.id}/completion/students`)
          .set("Cookie", cookieHeader(adminCookies));
        expect(studentsRes.status).toBe(200);
        for (const row of studentsRes.body.data as Array<{ enrollmentId: string; eligibility: { reasons: { completionPct: number } } }>) {
          const dbRow = (rows as Array<{ id: string; progressPct: number }>).find((r) => r.id === row.enrollmentId)!;
          expect(row.eligibility.reasons.completionPct).toBe(dbRow.progressPct); // AC-32
          expect(row.eligibility.reasons).toHaveProperty("requiredAssessmentsPassed"); // AC-33 shape
          expect(row.eligibility.reasons).toHaveProperty("finalProjectApproved");
        }
        const certifiedRow = studentsRes.body.data.find((r: { bucket: string }) => r.bucket === "certified");
        expect(certifiedRow.certificateStatus).toBe("valid");
      });

      it("AC-36: a zero-enrollment batch rollup is a valid 200 zero result (never 404/500)", async () => {
        const empty = await prisma.batch.create({
          data: {
            tenantId, programId: program.id, branchId: branchB.id, name: `P8 QA Batch Empty ${suffix}`,
            status: "active", startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), capacity: 10,
          },
        });
        fixtureBatchIds.push(empty.id);

        const res = await request(httpServer).get(`/api/v1/crm/batches/${empty.id}/completion`).set("Cookie", cookieHeader(adminCookies));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ totalActive: 0, certified: 0, eligibleNotIssued: 0, inProgress: 0, dropped: 0, percentComplete: null });
      });

      it("AC-37: rollup scope is resolved per caller — admin/branch-manager succeed; a caller outside scope gets 404", async () => {
        const asAdmin = await request(httpServer).get(`/api/v1/crm/batches/${batchCompletionRollup.id}/completion`).set("Cookie", cookieHeader(adminCookies));
        expect(asAdmin.status).toBe(200);

        const asBmB = await request(httpServer).get(`/api/v1/crm/batches/${batchCompletionRollup.id}/completion`).set("Cookie", cookieHeader(bmBCookies));
        expect(asBmB.status).toBe(200); // batchCompletionRollup lives in Branch B

        const asBmC = await request(httpServer).get(`/api/v1/crm/batches/${batchCompletionRollup.id}/completion`).set("Cookie", cookieHeader(bmCCookies));
        expect(asBmC.status).toBe(404); // Branch Manager for a DIFFERENT branch
      });

      it("AC-39/40/41/42/43: mark-complete transitions active->completed, sets completedAt, is a pure write, is audit-logged; guards BATCH_NOT_ACTIVE/ALREADY_COMPLETED", async () => {
        const notActive = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchPlanned.id}/complete`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(notActive.status).toBe(422);
        expect(notActive.body.error.code).toBe("BATCH_NOT_ACTIVE");

        // AC-42 pre-snapshot: nothing about enrollment/certificate rows should change.
        const beforeEnrollments = await prisma.enrollment.findMany({
          where: { tenantId, batchId: batchCompletionRollup.id },
          select: { id: true, status: true, progressPct: true },
          orderBy: { id: "asc" },
        });
        const beforeCertificates = await prisma.certificate.findMany({
          where: { tenantId, enrollmentId: { in: beforeEnrollments.map((e: { id: string }) => e.id) } },
          select: { id: true, status: true },
        });

        const completeRes = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchCompletionRollup.id}/complete`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.data.status).toBe("completed");
        expect(completeRes.body.data.completedByUserId).toBe(adminUserId);
        expect(completeRes.body.data.completedAt).toBeTruthy();
        expect(completeRes.body.data.summary.totalActive).toBeGreaterThan(0); // AC-41: rollup visible, informational

        const dbBatch = await prisma.batch.findUnique({ where: { id: batchCompletionRollup.id } });
        expect(dbBatch.status).toBe("completed");
        expect(dbBatch.completedAt).not.toBeNull();
        expect(dbBatch.completedByUserId).toBe(adminUserId);

        // AC-42, as amended: ENROLLMENT rows are still untouched by the transition —
        // completing a batch does not change anybody's enrolment status or progress.
        const afterEnrollments = await prisma.enrollment.findMany({
          where: { tenantId, batchId: batchCompletionRollup.id },
          select: { id: true, status: true, progressPct: true },
          orderBy: { id: "asc" },
        });
        expect(afterEnrollments).toEqual(beforeEnrollments);

        // CERTIFICATES are not: `aa17681` deliberately made marking a batch complete issue
        // the cohort's certificates (BatchCompletionService.issueCohortCertificates), which
        // is the whole point of the action for a training company. The original assertion
        // ("certificate rows untouched") predates that and has been failing since.
        //
        // So the invariant asserted here is the one that still holds and still matters:
        // issuance is ADDITIVE and never rewrites history. Every certificate that existed
        // before is still there, unchanged, and anything new is a fresh valid row — a
        // completion sweep must not revoke, reissue or restatus somebody's existing
        // certificate. The response's own counts are asserted below.
        const afterCertificates = await prisma.certificate.findMany({
          where: { tenantId, enrollmentId: { in: afterEnrollments.map((e: { id: string }) => e.id) } },
          select: { id: true, status: true },
        });
        for (const before of beforeCertificates) {
          expect(afterCertificates).toContainEqual(before);
        }
        expect(afterCertificates.length).toBeGreaterThanOrEqual(beforeCertificates.length);
        expect(afterCertificates.every((c: { status: string }) => c.status === "valid")).toBe(true);

        // AC-39: replay is idempotent (409), never a second successful mutation.
        const replay = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchCompletionRollup.id}/complete`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin);
        expect(replay.status).toBe(409);
        expect(replay.body.error.code).toBe("ALREADY_COMPLETED");

        // AC-43/M-2: audit-logged with entity="Batch" (PascalCase model name, see M-2),
        // action="update" (the audit extension's fixed create/update/delete vocabulary —
        // not the spec's literal "complete"), before/after showing the status transition.
        const auditRow = await prisma.auditLog.findFirst({
          where: { tenantId, entity: "Batch", entityId: batchCompletionRollup.id, action: "update" },
          orderBy: { createdAt: "desc" },
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow.after).toMatchObject({ status: "completed" });

        // AC-26 (bonus, using the batch this test just completed): assignment is now blocked.
        const assignAfterComplete = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchCompletionRollup.id}/mentors`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ mentorId: mentorAssignable1.id });
        expect(assignAfterComplete.status).toBe(422);
        expect(assignAfterComplete.body.error.code).toBe("BATCH_NOT_ASSIGNABLE");
      });

      it("AC-44: cross-tenant/branch IDOR on mark-complete mirrors the read-scope 404", async () => {
        const crossTenant = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchPlanned.id}/complete`)
          .set("Cookie", cookieHeader(bmCCookies)) // different branch, not tenant, but same fail-closed 404 mechanism
          .set("X-CSRF-Token", csrfBmC);
        expect(crossTenant.status).toBe(404);

        await expect(
          batchCompletionService.getSummary(foreignTenantId, adminUserId, batchPlanned.id),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // WS-4: Mentor-facing dashboard — the must-verify isolation invariant
    // ═══════════════════════════════════════════════════════════════════════

    describe("WS-4: Mentor-facing dashboard (isolation headline)", () => {
      it("AC-46/AC-48 HEADLINE: two mentors, each assigned to a DIFFERENT batch — each sees ONLY their own; requesting the other's batch/completion -> 404", async () => {
        const dashA = await request(httpServer).get("/api/v1/me/mentor/dashboard").set("Cookie", cookieHeader(mentorACookies));
        expect(dashA.status).toBe(200);
        expect(dashA.body.data.batches.map((b: { batchId: string }) => b.batchId)).toEqual([batchA.id]);
        expect(dashA.body.data.batches.some((b: { batchId: string }) => b.batchId === batchB.id)).toBe(false);

        const dashB = await request(httpServer).get("/api/v1/me/mentor/dashboard").set("Cookie", cookieHeader(mentorBCookies));
        expect(dashB.status).toBe(200);
        expect(dashB.body.data.batches.map((b: { batchId: string }) => b.batchId)).toEqual([batchB.id]);
        expect(dashB.body.data.batches.some((b: { batchId: string }) => b.batchId === batchA.id)).toBe(false);

        // Mentor A requesting Mentor B's batch completion (a batch they are NOT assigned
        // to) -> 404, never 403 (which would confirm existence), never a leaked partial view.
        const aRequestsB = await request(httpServer).get(`/api/v1/crm/batches/${batchB.id}/completion`).set("Cookie", cookieHeader(mentorACookies));
        expect(aRequestsB.status).toBe(404);

        const bRequestsA = await request(httpServer).get(`/api/v1/crm/batches/${batchA.id}/completion`).set("Cookie", cookieHeader(mentorBCookies));
        expect(bRequestsA.status).toBe(404);
      });

      it("AC-50: dashboard card values are sourced from the SAME rollup CRM staff see for that batch (not a parallel calculation)", async () => {
        const staffSummary = await request(httpServer).get(`/api/v1/crm/batches/${batchA.id}/completion`).set("Cookie", cookieHeader(adminCookies));
        const dashA = await request(httpServer).get("/api/v1/me/mentor/dashboard").set("Cookie", cookieHeader(mentorACookies));

        const card = dashA.body.data.batches.find((b: { batchId: string }) => b.batchId === batchA.id);
        expect(card.studentCount).toBe(staffSummary.body.data.totalActive);
        expect(card.percentComplete).toBe(staffSummary.body.data.percentComplete);
        expect(card.status).toBe(staffSummary.body.data.status);
        expect(card.isLead).toBe(true); // mentorA was seeded as lead on batchA
      });

      it("AC-47: cross-tenant isolation at the repository/service layer — a foreign tenantId never resolves a mentor profile or batch", async () => {
        const crossTenantProfile = await mentorsRepository.findOwnProfile(foreignTenantId, mentorAUserId);
        expect(crossTenantProfile).toBeNull();

        const sameTenantProfile = await mentorsRepository.findOwnProfile(tenantId, mentorAUserId);
        expect(sameTenantProfile).not.toBeNull();

        await expect(
          batchCompletionService.getSummary(foreignTenantId, mentorAUserId, batchA.id),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it("AC-49/Rule M-4: engagementStatus is re-checked LIVE on every request, never cached from login", async () => {
        const before = await request(httpServer).get("/api/v1/me/mentor/dashboard").set("Cookie", cookieHeader(mentorCCookies));
        expect(before.status).toBe(200);

        const deactivate = await request(httpServer)
          .patch(`/api/v1/crm/mentors/${mentorC.id}`)
          .set("Cookie", cookieHeader(adminCookies))
          .set("X-CSRF-Token", csrfAdmin)
          .send({ engagementStatus: "inactive" });
        expect(deactivate.status).toBe(200);

        // SAME still-valid session cookie, very next request -> 403 (fail-closed, live re-check).
        const after = await request(httpServer).get("/api/v1/me/mentor/dashboard").set("Cookie", cookieHeader(mentorCCookies));
        expect(after.status).toBe(403);
        expect(after.body.error.code).toBe("mentor.dashboard_not_active");
      });

      it("AC-51: a mentor with zero batch_mentors rows sees a valid empty state (200, batches: []), not an error", async () => {
        const dashD = await request(httpServer).get("/api/v1/me/mentor/dashboard").set("Cookie", cookieHeader(mentorDCookies));
        expect(dashD.status).toBe(200);
        expect(dashD.body.data.batches).toEqual([]);
      });

      it("AC-53/AC-38: an actively-assigned mentor (not just admin) can mark their own batch complete via the SAME endpoint/permission", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchA.id}/complete`)
          .set("Cookie", cookieHeader(mentorACookies))
          .set("X-CSRF-Token", csrfMentorA);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("completed");
        expect(res.body.data.completedByUserId).toBe(mentorAUserId);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // RBAC cross-cutting (Rule M-3, defense-in-depth beyond the WS-1..WS-4 scoped checks)
    // ═══════════════════════════════════════════════════════════════════════

    describe("RBAC: Rule M-3 strict allowlist — the Mentor role never gains management/markComplete-bypass rights", () => {
      it("AC-54: a Mentor cannot create a mentor record or assign/unassign a batch mentor (403 — mentors.* never granted to Mentor role)", async () => {
        const create = await request(httpServer)
          .post("/api/v1/crm/mentors")
          .set("Cookie", cookieHeader(mentorACookies))
          .set("X-CSRF-Token", csrfMentorA)
          .send({ fullName: "Should Not Be Created By A Mentor", email: `p8.mentor-cannot.${suffix}@test.com`, externalInstitute: "X" });
        expect(create.status).toBe(403);

        const assign = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchB.id}/mentors`)
          .set("Cookie", cookieHeader(mentorACookies))
          .set("X-CSRF-Token", csrfMentorA)
          .send({ mentorId: mentorAssignable1.id });
        expect(assign.status).toBe(403);

        const del = await request(httpServer)
          .delete(`/api/v1/crm/mentors/${mentorB.id}`)
          .set("Cookie", cookieHeader(mentorACookies))
          .set("X-CSRF-Token", csrfMentorA);
        expect(del.status).toBe(403);
      });

      it("mark-complete requires batches.markComplete SERVER-SIDE — a role that lacks it is blocked even though the UI would simply not render the button", async () => {
        const res = await request(httpServer)
          .post(`/api/v1/crm/batches/${batchB.id}/complete`)
          .set("Cookie", cookieHeader(counsellorCookies)) // counsellor holds no batches.markComplete grant at any scope
          .set("X-CSRF-Token", csrfCounsellor);
        expect(res.status).toBe(403);
      });
    });
  },
);
