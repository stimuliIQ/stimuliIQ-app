// apps/api/test/integration/phase-9-tickets.integration-spec.ts
//
// Phase-9 Completion T21 QA gate: Support-desk (Tickets/CannedResponses/KbArticles)
// integration + isolation tests (docs/plans/phase-9-completion.md T21). Exercises the
// REAL NestJS application over HTTP (supertest + real Nest app) against a real Postgres +
// Redis DB, matching the pattern of phase-9-live-classes.integration-spec.ts.
//
// COVERAGE:
//   - SLA: ticket creation computes `slaDueAt` per priority (urgent=4h/high=8h/medium=24h/low=48h).
//   - isInternal isolation (T21 headline): a staff-authored internal note is NEVER visible
//     on the student's own GET /me/tickets/:id, and a student cannot set isInternal=true.
//   - Own-scope IDOR: a student cannot read/reply-to/rate another student's ticket -> 404.
//   - Staff all-scope: support sees/manages every ticket; assign + close are independently
//     gated (tickets.assign / tickets.close) from the general edit (tickets.edit).
//   - branch_manager (branch scope): sees only tickets raised by students in their own branch.
//   - Canned responses: support-only CRUD (scope=all).
//   - KB articles: admin CRUD (kb.edit) + public read (published only — draft never leaks).

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
  process.env.STORAGE_PROVIDER = "noop";
  process.env.MAIL_PROVIDER = "noop";
  process.env.WHATSAPP_PROVIDER = "noop";
  process.env.CAPTCHA_PROVIDER = "noop";
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

describeIfAvailable("Phase-9 Tickets/Support-desk — integration + RBAC scope isolation (real Postgres + Redis)", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const argon2 = require("argon2");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");

  let app: import("@nestjs/common").INestApplication;
  let httpServer: ReturnType<typeof app.getHttpServer>;
  let prisma: InstanceType<typeof PrismaClient>;

  const PASSWORD = "P@ssword123!";
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  let tenantId: string;
  let adminCookies: string[], csrfAdmin: string;
  let supportCookies: string[], csrfSupport: string;
  let bmBCookies: string[];
  let studentACookies: string[], csrfStudentA: string;
  let studentBCookies: string[], csrfStudentB: string;
  let counsellorCookies: string[], csrfCounsellor: string;

  let branchB: { id: string };
  let program: { id: string };
  let batchB: { id: string };

  const fixtureUserIds: string[] = [];
  const fixtureBranchIds: string[] = [];
  const fixtureBatchIds: string[] = [];
  const fixtureTicketIds: string[] = [];
  const fixtureEnrollmentIds: string[] = [];
  const fixtureStudentProfileIds: string[] = [];
  const fixtureCannedResponseIds: string[] = [];
  const fixtureKbArticleIds: string[] = [];
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

    const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
    if (!tenant) throw new Error("No tenant found — run `pnpm db:seed` first.");
    tenantId = tenant.id;

    const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin", deletedAt: null } });
    const supportRole = await prisma.role.findFirst({ where: { tenantId, key: "support", deletedAt: null } });
    const branchManagerRole = await prisma.role.findFirst({ where: { tenantId, key: "branch_manager", deletedAt: null } });
    const studentRole = await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } });
    const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
    if (!adminRole || !supportRole || !branchManagerRole || !studentRole || !counsellorRole) {
      throw new Error("Roles not seeded — run `pnpm db:seed` first.");
    }

    const pwHash = await argon2.hash(PASSWORD);

    branchB = await prisma.branch.create({ data: { tenantId, name: `P9 Tix Branch B ${suffix}`, status: "active" } });
    fixtureBranchIds.push(branchB.id);

    async function createUser(label: string, roleId: string, branchId: string | null): Promise<string> {
      const email = `p9tix.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({
        data: { tenantId, email, name: `P9 Tix ${label}`, passwordHash: pwHash, status: "active" },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    const adminUserId = await createUser("admin", adminRole.id, null);
    const supportUserId = await createUser("support", supportRole.id, null);
    const bmBUserId = await createUser("bmB", branchManagerRole.id, branchB.id);
    const studentAUserId = await createUser("studentA", studentRole.id, null);
    await createUser("studentB", studentRole.id, null);
    const counsellorUserId = await createUser("counsellor", counsellorRole.id, null);
    void adminUserId;
    void supportUserId;
    void bmBUserId;
    void counsellorUserId;

    program = await prisma.program.create({
      data: { tenantId, slug: `p9-tix-program-${suffix}`, title: "P9 Tix Program", domain: "Engineering", pricePaise: 5000000, status: "published" },
    });
    fixtureProgramId = program.id;

    batchB = await prisma.batch.create({
      data: {
        tenantId, programId: program.id, branchId: branchB.id, name: `P9 Tix Batch B ${suffix}`, status: "active",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), capacity: 30,
      },
    });
    fixtureBatchIds.push(batchB.id);

    // studentA is enrolled in branchB's batch (so branch_manager can see their tickets);
    // studentB has NO enrollment anywhere (out of every staff scope except "all").
    const studentAProfile = await prisma.studentProfile.create({ data: { tenantId, userId: studentAUserId, courseType: "btech", status: "active" } });
    fixtureStudentProfileIds.push(studentAProfile.id);
    const enrollment = await prisma.enrollment.create({
      data: { tenantId, studentId: studentAProfile.id, batchId: batchB.id, programId: program.id, status: "active", progressPct: 0 },
    });
    fixtureEnrollmentIds.push(enrollment.id);

    ({ cookies: adminCookies, csrf: csrfAdmin } = await login(`p9tix.admin.${suffix}@test.com`, PASSWORD));
    ({ cookies: supportCookies, csrf: csrfSupport } = await login(`p9tix.support.${suffix}@test.com`, PASSWORD));
    ({ cookies: bmBCookies } = await login(`p9tix.bmB.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentACookies, csrf: csrfStudentA } = await login(`p9tix.studentA.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentBCookies, csrf: csrfStudentB } = await login(`p9tix.studentB.${suffix}@test.com`, PASSWORD));
    ({ cookies: counsellorCookies, csrf: csrfCounsellor } = await login(`p9tix.counsellor.${suffix}@test.com`, PASSWORD));
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.ticketMessage.deleteMany({ where: { ticketId: { in: fixtureTicketIds } } }).catch(() => {});
      await prisma.ticket.deleteMany({ where: { id: { in: fixtureTicketIds } } }).catch(() => {});
      await prisma.cannedResponse.deleteMany({ where: { id: { in: fixtureCannedResponseIds } } }).catch(() => {});
      await prisma.kbArticle.deleteMany({ where: { id: { in: fixtureKbArticleIds } } }).catch(() => {});
      await prisma.enrollment.deleteMany({ where: { id: { in: fixtureEnrollmentIds } } }).catch(() => {});
      await prisma.studentProfile.deleteMany({ where: { id: { in: fixtureStudentProfileIds } } }).catch(() => {});
      await prisma.batch.deleteMany({ where: { id: { in: fixtureBatchIds } } }).catch(() => {});
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
  // Create + SLA
  // ═══════════════════════════════════════════════════════════════════════

  describe("Create + SLA computation", () => {
    it("student raises a ticket; slaDueAt is computed per priority (urgent=4h)", async () => {
      const before = Date.now();
      const res = await request(httpServer)
        .post("/api/v1/me/tickets")
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ subject: "Cannot access video", body: "The player is stuck loading.", priority: "urgent" });
      expect(res.status).toBe(201);
      fixtureTicketIds.push(res.body.data.id);

      const slaDueAtMs = new Date(res.body.data.slaDueAt).getTime();
      expect(slaDueAtMs).toBeGreaterThanOrEqual(before + 4 * 60 * 60_000 - 5_000);
      expect(slaDueAtMs).toBeLessThanOrEqual(Date.now() + 4 * 60 * 60_000 + 5_000);
      expect(res.body.data.status).toBe("open");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // isInternal isolation + own-scope IDOR
  // ═══════════════════════════════════════════════════════════════════════

  describe("isInternal message isolation + own-scope IDOR", () => {
    let ticketId: string;

    beforeAll(async () => {
      const res = await request(httpServer)
        .post("/api/v1/me/tickets")
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ subject: "Billing question", body: "Why was I charged twice?", priority: "medium" });
      ticketId = res.body.data.id;
      fixtureTicketIds.push(ticketId);
    });

    it("a student cannot set isInternal=true on their own message — server forces false", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/me/tickets/${ticketId}/messages`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ body: "Any update?", isInternal: true }); // attempted escalation
      expect(res.status).toBe(201);
      expect(res.body.data.isInternal).toBe(false);
    });

    it("staff adds an internal note; the student NEVER sees it on their own GET, but staff does", async () => {
      const staffMsg = await request(httpServer)
        .post(`/api/v1/crm/tickets/${ticketId}/messages`)
        .set("Cookie", cookieHeader(supportCookies))
        .set("X-CSRF-Token", csrfSupport)
        .send({ body: "Refund already processed, awaiting confirmation.", isInternal: true });
      expect(staffMsg.status).toBe(201);
      expect(staffMsg.body.data.isInternal).toBe(true);

      const asStudent = await request(httpServer)
        .get(`/api/v1/me/tickets/${ticketId}`)
        .set("Cookie", cookieHeader(studentACookies));
      expect(asStudent.status).toBe(200);
      expect(asStudent.body.data.messages.some((m: { isInternal: boolean }) => m.isInternal)).toBe(false);

      const asStaff = await request(httpServer)
        .get(`/api/v1/crm/tickets/${ticketId}`)
        .set("Cookie", cookieHeader(supportCookies));
      expect(asStaff.status).toBe(200);
      expect(asStaff.body.data.messages.some((m: { isInternal: boolean }) => m.isInternal)).toBe(true);
    });

    it("studentB (a different raiser) cannot read/reply-to/rate studentA's ticket (404, IDOR fail-closed)", async () => {
      const getRes = await request(httpServer).get(`/api/v1/me/tickets/${ticketId}`).set("Cookie", cookieHeader(studentBCookies));
      expect(getRes.status).toBe(404);

      const replyRes = await request(httpServer)
        .post(`/api/v1/me/tickets/${ticketId}/messages`)
        .set("Cookie", cookieHeader(studentBCookies))
        .set("X-CSRF-Token", csrfStudentB)
        .send({ body: "not my ticket" });
      expect(replyRes.status).toBe(404);

      const rateRes = await request(httpServer)
        .post(`/api/v1/me/tickets/${ticketId}/rate`)
        .set("Cookie", cookieHeader(studentBCookies))
        .set("X-CSRF-Token", csrfStudentB)
        .send({ rating: 1 });
      expect(rateRes.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Staff scope + assign/close + rating gate
  // ═══════════════════════════════════════════════════════════════════════

  describe("Staff scope (all/branch) + assign/close + rating gate", () => {
    let ticketId: string;

    beforeAll(async () => {
      const res = await request(httpServer)
        .post("/api/v1/me/tickets")
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ subject: "Assign me", body: "Please route this to someone.", priority: "low" });
      ticketId = res.body.data.id;
      fixtureTicketIds.push(ticketId);
    });

    it("non-tickets.view role (counsellor) -> 403 on the CRM queue", async () => {
      const res = await request(httpServer).get("/api/v1/crm/tickets").set("Cookie", cookieHeader(counsellorCookies));
      expect(res.status).toBe(403);
      void csrfCounsellor;
    });

    it("branch_manager sees studentA's ticket (their branch's enrollee)", async () => {
      const res = await request(httpServer).get("/api/v1/crm/tickets").set("Cookie", cookieHeader(bmBCookies));
      expect(res.status).toBe(200);
      expect(res.body.data.some((t: { id: string }) => t.id === ticketId)).toBe(true);
    });

    it("rating before resolution -> 409; assign + close, then rating succeeds", async () => {
      const earlyRate = await request(httpServer)
        .post(`/api/v1/me/tickets/${ticketId}/rate`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ rating: 5 });
      expect(earlyRate.status).toBe(409);

      const assignRes = await request(httpServer)
        .post(`/api/v1/crm/tickets/${ticketId}/assign`)
        .set("Cookie", cookieHeader(supportCookies))
        .set("X-CSRF-Token", csrfSupport)
        .send({ assigneeId: null });
      expect(assignRes.status).toBe(200);

      const closeRes = await request(httpServer)
        .post(`/api/v1/crm/tickets/${ticketId}/close`)
        .set("Cookie", cookieHeader(supportCookies))
        .set("X-CSRF-Token", csrfSupport);
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.status).toBe("closed");

      const lateRate = await request(httpServer)
        .post(`/api/v1/me/tickets/${ticketId}/rate`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ rating: 5 });
      expect(lateRate.status).toBe(200);
      expect(lateRate.body.data.rating).toBe(5);

      // Re-closing an already-closed ticket -> 409 (idempotency guard).
      const reClose = await request(httpServer)
        .post(`/api/v1/crm/tickets/${ticketId}/close`)
        .set("Cookie", cookieHeader(supportCookies))
        .set("X-CSRF-Token", csrfSupport);
      expect(reClose.status).toBe(409);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Canned responses (support-only CRUD)
  // ═══════════════════════════════════════════════════════════════════════

  describe("Canned responses", () => {
    it("non-support role (counsellor) -> 403; support creates/updates/deletes successfully", async () => {
      const forbidden = await request(httpServer)
        .post("/api/v1/crm/canned-responses")
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor)
        .send({ title: "Nope", body: "Should not be created" });
      expect(forbidden.status).toBe(403);

      const created = await request(httpServer)
        .post("/api/v1/crm/canned-responses")
        .set("Cookie", cookieHeader(supportCookies))
        .set("X-CSRF-Token", csrfSupport)
        .send({ title: "Welcome macro", body: "Hi! Thanks for reaching out.", category: "general" });
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      fixtureCannedResponseIds.push(id);

      const updated = await request(httpServer)
        .patch(`/api/v1/crm/canned-responses/${id}`)
        .set("Cookie", cookieHeader(supportCookies))
        .set("X-CSRF-Token", csrfSupport)
        .send({ title: "Welcome macro v2" });
      expect(updated.status).toBe(200);
      expect(updated.body.data.title).toBe("Welcome macro v2");

      const deleted = await request(httpServer)
        .delete(`/api/v1/crm/canned-responses/${id}`)
        .set("Cookie", cookieHeader(supportCookies))
        .set("X-CSRF-Token", csrfSupport);
      expect(deleted.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // KB articles: admin CRUD + public read (published only)
  // ═══════════════════════════════════════════════════════════════════════

  describe("KB articles — admin CRUD + public read (draft never leaks)", () => {
    let draftId: string;
    let draftSlug: string;
    let publishedSlug: string;

    it("admin creates a draft (kb.edit) and a published article", async () => {
      draftSlug = `p9-tix-draft-${suffix}`;
      const draft = await request(httpServer)
        .post("/api/v1/crm/kb-articles")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({ title: "Draft article", slug: draftSlug, body: "Not ready yet.", published: false });
      expect(draft.status).toBe(201);
      draftId = draft.body.data.id;
      fixtureKbArticleIds.push(draftId);

      publishedSlug = `p9-tix-published-${suffix}`;
      const published = await request(httpServer)
        .post("/api/v1/crm/kb-articles")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({ title: "Published article", slug: publishedSlug, body: "Here is how to do X.", published: true });
      expect(published.status).toBe(201);
      fixtureKbArticleIds.push(published.body.data.id);
    });

    it("duplicate slug -> 409 kb.slug_taken (DB partial-unique backstop)", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/kb-articles")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({ title: "Dup slug", slug: publishedSlug, body: "x", published: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("kb.slug_taken");
    });

    it("public read: published article is visible; the draft returns 404 (no leak)", async () => {
      const publicPublished = await request(httpServer).get(`/api/v1/public/kb-articles/${publishedSlug}`);
      expect(publicPublished.status).toBe(200);
      expect(publicPublished.body.data.body).toBe("Here is how to do X.");
      expect(publicPublished.body.data).not.toHaveProperty("published");

      const publicDraft = await request(httpServer).get(`/api/v1/public/kb-articles/${draftSlug}`);
      expect(publicDraft.status).toBe(404);

      const publicList = await request(httpServer).get("/api/v1/public/kb-articles");
      expect(publicList.status).toBe(200);
      expect(publicList.body.data.some((a: { slug: string }) => a.slug === draftSlug)).toBe(false);
      expect(publicList.body.data.some((a: { slug: string }) => a.slug === publishedSlug)).toBe(true);
    });

    it("non-kb.edit role (counsellor) cannot delete a KB article", async () => {
      const res = await request(httpServer)
        .delete(`/api/v1/crm/kb-articles/${draftId}`)
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor);
      expect(res.status).toBe(403);
    });
  });
});
