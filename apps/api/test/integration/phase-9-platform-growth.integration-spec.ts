// apps/api/test/integration/phase-9-platform-growth.integration-spec.ts
//
// Phase-9 Completion T23/T30(growth) QA gate: settings, landing-pages,
// and lead-forms — integration tests against the REAL NestJS application (supertest +
// real Nest app) over a real Postgres + Redis DB, matching the pattern of
// phase-9-content.integration-spec.ts.
//
// COVERAGE:
//   (Feature flags were also covered here until the seam was removed — nothing in any
//     app ever evaluated a flag, so the table, endpoints and CRM screen were deleted.)
//   Settings — system vs company scope; branch_manager may VIEW (branch scope) but not
//     EDIT; admin may edit; RBAC deny for a role holding neither.
//   Landing pages — create() publish-gate (status='published' in the body is downgraded
//     to 'draft'); PATCH CAN publish directly (different from blog's separate-route
//     gate — documented service behavior); public read only ever serves published;
//     A/B variant resolution; RBAC (branch_manager view-only cannot create).
//   Lead forms — CRM CRUD; public config read only serves `active=true`; inactive/
//     unknown key -> 404 (no existence leak); RBAC deny-by-default.

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
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

function cookieHeader(cookies: string[]): string {
  return cookies.map((c) => c.split(";")[0]!).join("; ");
}

function extractCsrfToken(cookies: string[]): string | undefined {
  const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
  return csrfCookie?.split("=")[1]?.split(";")[0];
}

describeIfAvailable("Phase-9 Platform (flags/settings) + Growth (landing-pages/lead-forms) — integration", () => {
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
  let branchManagerCookies: string[], csrfBranchManager: string;
  let marketingCookies: string[], csrfMarketing: string;
  let counsellorCookies: string[], csrfCounsellor: string;

  const fixtureUserIds: string[] = [];
  const fixtureLandingPageIds: string[] = [];
  const fixtureLeadFormIds: string[] = [];

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
    const branchManagerRole = await prisma.role.findFirst({ where: { tenantId, key: "branch_manager", deletedAt: null } });
    const marketingRole = await prisma.role.findFirst({ where: { tenantId, key: "marketing", deletedAt: null } });
    const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
    if (!adminRole || !branchManagerRole || !marketingRole || !counsellorRole) {
      throw new Error("Roles not seeded — run `pnpm db:seed` first.");
    }

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string, roleId: string, branchId: string | null = null): Promise<string> {
      const email = `p9pg.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({ data: { tenantId, email, name: `P9 PG ${label}`, passwordHash: pwHash, status: "active" } });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    await createUser("admin", adminRole.id);
    await createUser("branchManager", branchManagerRole.id);
    await createUser("marketing", marketingRole.id);
    await createUser("counsellor", counsellorRole.id);

    ({ cookies: adminCookies, csrf: csrfAdmin } = await login(`p9pg.admin.${suffix}@test.com`, PASSWORD));
    ({ cookies: branchManagerCookies, csrf: csrfBranchManager } = await login(`p9pg.branchManager.${suffix}@test.com`, PASSWORD));
    ({ cookies: marketingCookies, csrf: csrfMarketing } = await login(`p9pg.marketing.${suffix}@test.com`, PASSWORD));
    ({ cookies: counsellorCookies, csrf: csrfCounsellor } = await login(`p9pg.counsellor.${suffix}@test.com`, PASSWORD));
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.landingPage.deleteMany({ where: { id: { in: fixtureLandingPageIds } } }).catch(() => {});
      await prisma.leadForm.deleteMany({ where: { id: { in: fixtureLeadFormIds } } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      // Gamification rows FK to `users`, and lesson completion now writes them.
      await prisma.pointsLedger.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userBadge.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════════════

  describe("Settings: system/company scope, view-vs-edit RBAC", () => {
    const settingKey = `p9-setting-${suffix}`;

    it("admin sets a company-scope setting", async () => {
      const res = await request(httpServer)
        .put(`/api/v1/crm/settings/company/${settingKey}`)
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({ value: { theme: "dark" } });
      expect(res.status).toBe(200);
      expect(res.body.data.value).toEqual({ theme: "dark" });
    });

    it("branch_manager (settings.view, branch scope) can VIEW but NOT edit", async () => {
      const viewRes = await request(httpServer)
        .get(`/api/v1/crm/settings/company/${settingKey}`)
        .set("Cookie", cookieHeader(branchManagerCookies));
      expect(viewRes.status).toBe(200);

      const editRes = await request(httpServer)
        .put(`/api/v1/crm/settings/company/${settingKey}`)
        .set("Cookie", cookieHeader(branchManagerCookies))
        .set("X-CSRF-Token", csrfBranchManager)
        .send({ value: { theme: "hacked" } });
      expect(editRes.status).toBe(403);
    });

    it("counsellor (no settings.*) -> 403 viewing settings", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/crm/settings/company/${settingKey}`)
        .set("Cookie", cookieHeader(counsellorCookies));
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Landing pages
  // ═══════════════════════════════════════════════════════════════════════

  describe("Landing pages: create publish-gate, PATCH-can-publish, public A/B read", () => {
    let pageId: string;
    const slug = `p9-lp-${suffix}`;

    it("branch_manager (landing_pages.view only) -> 403 creating a page", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/landing-pages")
        .set("Cookie", cookieHeader(branchManagerCookies))
        .set("X-CSRF-Token", csrfBranchManager)
        .send({ slug, title: "Should not be created", content: [] });
      expect(res.status).toBe(403);
    });

    it("marketing creates a page — status='published' in the body is downgraded to 'draft'", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/landing-pages")
        .set("Cookie", cookieHeader(marketingCookies))
        .set("X-CSRF-Token", csrfMarketing)
        .send({ slug, title: "Full Stack Bootcamp — August Batch", variant: "a", content: [{ type: "hero", data: { headline: "Enroll now" } }], status: "published" });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("draft");
      pageId = res.body.data.id;
      fixtureLandingPageIds.push(pageId);
    });

    it("a DRAFT page is NEVER visible via public read", async () => {
      const res = await request(httpServer).get(`/api/v1/public/landing-pages/${slug}`);
      expect(res.status).toBe(404);
    });

    it("PATCH CAN publish directly (landing-pages: no separate /publish route, unlike blog)", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/landing-pages/${pageId}`)
        .set("Cookie", cookieHeader(marketingCookies))
        .set("X-CSRF-Token", csrfMarketing)
        .send({ status: "published" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("published");
      expect(res.body.data.publishedAt).not.toBeNull();
    });

    it("the published page IS visible via public read, keyed by slug (+variant)", async () => {
      const res = await request(httpServer).get(`/api/v1/public/landing-pages/${slug}`).query({ variant: "a" });
      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Full Stack Bootcamp — August Batch");
    });

    it("an unknown slug -> 404 (no existence leak)", async () => {
      const res = await request(httpServer).get(`/api/v1/public/landing-pages/${slug}-does-not-exist`);
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Lead forms
  // ═══════════════════════════════════════════════════════════════════════

  describe("Lead forms: CRM CRUD, active-only public config read", () => {
    const formKey = `p9-lf-${suffix}`;
    let formId: string;

    it("counsellor (no lead_forms.*) -> 403 creating a form", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/lead-forms")
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor)
        .send({ key: formKey, name: "Should not be created", fields: [{ key: "email", label: "Email", type: "email" }] });
      expect(res.status).toBe(403);
    });

    it("marketing creates an ACTIVE lead form", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/lead-forms")
        .set("Cookie", cookieHeader(marketingCookies))
        .set("X-CSRF-Token", csrfMarketing)
        .send({
          key: formKey,
          name: "Homepage Hero Form",
          fields: [
            { key: "name", label: "Full Name", type: "text", required: true },
            { key: "email", label: "Email", type: "email", required: true },
          ],
          active: true,
        });
      expect(res.status).toBe(201);
      formId = res.body.data.id;
      fixtureLeadFormIds.push(formId);
    });

    it("public config read serves the ACTIVE form's field config", async () => {
      const res = await request(httpServer).get(`/api/v1/public/lead-forms/${formKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.fields).toHaveLength(2);
      expect(res.body.data).not.toHaveProperty("active"); // internal-only field not leaked
    });

    it("marketing deactivates the form — public read now 404s (no existence leak)", async () => {
      await request(httpServer)
        .patch(`/api/v1/crm/lead-forms/${formId}`)
        .set("Cookie", cookieHeader(marketingCookies))
        .set("X-CSRF-Token", csrfMarketing)
        .send({ active: false })
        .expect(200);

      const res = await request(httpServer).get(`/api/v1/public/lead-forms/${formKey}`);
      expect(res.status).toBe(404);
    });

    it("an unknown key -> 404 (indistinguishable from inactive)", async () => {
      const res = await request(httpServer).get(`/api/v1/public/lead-forms/${formKey}-does-not-exist`);
      expect(res.status).toBe(404);
    });
  });
});
