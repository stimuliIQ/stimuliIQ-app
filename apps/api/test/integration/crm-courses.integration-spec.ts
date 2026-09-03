// apps/api/test/integration/crm-courses.integration-spec.ts
//
// P1 CRM-core integration coverage (qa-engineer, Wave 5, docs/plans/phase-1.md task #8)
// for the courses (programs/modules/lessons) module: CRUD happy-path at scope=all, plus
// the documented KNOWN-GAP that "assigned" scope fails closed (no program-authorship
// column exists yet — see courses.service.ts assertResolvableScope()). Run against REAL
// Postgres + Redis and the REAL Nest AppModule.
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

describeIfAvailable("CRM courses (programs/modules/lessons) — CRUD + KNOWN-GAP scope", () => {
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
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    FACULTY_A_EMAIL,
    FACULTY_A_PASSWORD,
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

  describe("programs CRUD (super_admin, scope=all)", () => {
    const slug = `qa-crud-program-${Date.now()}`;
    let programId: string;

    it("POST /crm/courses creates a program", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/courses")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          slug,
          title: "QA CRUD Program",
          domain: "test",
          level: "beginner",
          mode: "hybrid",
          durationWeeks: 8,
          pricePaise: 50000,
          status: "draft",
        })
        .expect(201);
      programId = res.body.data.id;
    });

    it("GET by id, list/filter, PATCH, publish, unpublish round-trip", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .get(`/api/v1/crm/courses/${programId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const list = await request(app.getHttpServer())
        .get("/api/v1/crm/courses")
        .query({ search: "QA CRUD Program" })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(list.body.data.some((p: { id: string }) => p.id === programId)).toBe(true);

      await request(app.getHttpServer())
        .patch(`/api/v1/crm/courses/${programId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ title: "QA CRUD Program Updated" })
        .expect(200);

      const published = await request(app.getHttpServer())
        .post(`/api/v1/crm/courses/${programId}/publish`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(published.body.data.status).toBe("published");

      const unpublished = await request(app.getHttpServer())
        .post(`/api/v1/crm/courses/${programId}/unpublish`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(unpublished.body.data.status).toBe("archived");
    });

    it("modules + lessons + reorder via curriculum sub-resource", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      const mod1 = await request(app.getHttpServer())
        .post(`/api/v1/crm/courses/${programId}/modules`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ title: "Module 1", order: 1 })
        .expect(201);
      const mod2 = await request(app.getHttpServer())
        .post(`/api/v1/crm/courses/${programId}/modules`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ title: "Module 2", order: 2 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/crm/courses/${programId}/modules/reorder`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ moduleIds: [mod2.body.data.id, mod1.body.data.id] })
        .expect(200);

      const lesson = await request(app.getHttpServer())
        .post(`/api/v1/crm/courses/${programId}/modules/${mod1.body.data.id}/lessons`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ title: "Lesson 1", type: "video", order: 1 })
        .expect(201);

      const curriculum = await request(app.getHttpServer())
        .get(`/api/v1/crm/courses/${programId}/curriculum`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(curriculum.body.data.modules.length).toBeGreaterThanOrEqual(2);
      expect(lesson.body.data.title).toBe("Lesson 1");
    });

    // `order` is server-owned, so a client cannot smuggle one in through create.
    it("rejects a client-supplied order on create (strict schema)", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .post("/api/v1/crm/courses")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          slug: `qa-order-reject-${Date.now()}`,
          title: "Order Reject",
          domain: "test",
          level: "beginner",
          mode: "hybrid",
          durationWeeks: 8,
          pricePaise: 50000,
          status: "draft",
          order: 0,
        })
        .expect(400);
    });

    it("badge round-trips, and rejects enabling one that cannot render", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      const saved = await request(app.getHttpServer())
        .patch(`/api/v1/crm/courses/${programId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ badgeColor: "#7C3AED", badgeLabel: "Limited seats", badgeEnabled: true })
        .expect(200);
      expect(saved.body.data.badgeColor).toBe("#7C3AED");
      expect(saved.body.data.badgeLabel).toBe("Limited seats");
      expect(saved.body.data.badgeEnabled).toBe(true);

      // Clearing the text while the badge is live would leave a blank chip.
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/courses/${programId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ badgeLabel: null })
        .expect(400);

      // A malformed colour is refused by the DTO before it can reach the column and
      // render as an unstyled chip.
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/courses/${programId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ badgeColor: "red" })
        .expect(400);
    });

    it("POST /crm/courses/reorder rewrites order from array position", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      const before = await request(app.getHttpServer())
        .get("/api/v1/crm/courses")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const ids: string[] = before.body.data.map((p: { id: string }) => p.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);

      // Move the last program to the front.
      const reversedFirst = [ids[ids.length - 1]!, ...ids.slice(0, -1)];
      await request(app.getHttpServer())
        .post("/api/v1/crm/courses/reorder")
        .set(authHeaders(accessToken, csrfToken))
        .send({ programIds: reversedFirst })
        .expect(204);

      const after = await request(app.getHttpServer())
        .get("/api/v1/crm/courses")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      // Compare only the ids this test actually reordered, in their new relative order.
      //
      // A plain `toEqual(reversedFirst)` assumed one 100-row page held every programme in
      // the tenant, which is true of a freshly seeded database and stops being true the
      // moment anything leaks — the tenant here is the SHARED "stimuliiq" one, and a
      // suite whose teardown failed leaves programmes behind. Past 100 rows the second
      // page shifts and this failed with an id it had never seen, which reads like a
      // reorder bug and is not one. Filtering to the ids under test makes the assertion
      // about `reorder`, which is what it is for.
      const reorderedSet = new Set(reversedFirst);
      const afterIds: string[] = after.body.data
        .map((p: { id: string }) => p.id)
        .filter((id: string) => reorderedSet.has(id));
      expect(afterIds).toEqual(reversedFirst);
      expect(after.body.data[0].order).toBe(0);
    });

    // Tenant isolation: a foreign id in the array must abort the WHOLE reorder, not be
    // silently skipped — otherwise the caller still succeeds in resequencing their own rows
    // while probing for another tenant's ids.
    it("rejects a reorder containing an id outside the tenant, leaving order untouched", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      const before = await request(app.getHttpServer())
        .get("/api/v1/crm/courses")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const ids: string[] = before.body.data.map((p: { id: string }) => p.id);

      await request(app.getHttpServer())
        .post("/api/v1/crm/courses/reorder")
        .set(authHeaders(accessToken, csrfToken))
        .send({ programIds: [...ids].reverse().concat("00000000-0000-4000-8000-000000000000") })
        .expect(404);

      const after = await request(app.getHttpServer())
        .get("/api/v1/crm/courses")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(after.body.data.map((p: { id: string }) => p.id)).toEqual(ids);
    });

    it("audit-on-mutation: create + update write Program audit rows", async () => {
      const createAudit = await prisma.auditLog.findFirst({ where: { entity: "Program", entityId: programId, action: "create" } });
      expect(createAudit).toBeTruthy();
      const updateAudit = await prisma.auditLog.findFirst({ where: { entity: "Program", entityId: programId, action: "update" } });
      expect(updateAudit).toBeTruthy();
    });
  });

  describe("courses KNOWN GAP: 'assigned' scope fails closed (no program-authorship column in P1 schema)", () => {
    it("faculty A (scope=assigned on courses.view) gets 403 courses.scope_unresolvable, NOT silently widened to all", async () => {
      const { accessToken, csrfToken } = await loginAs(FACULTY_A_EMAIL, FACULTY_A_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/courses")
        .set(authHeaders(accessToken, csrfToken))
        .expect(403);
      expect(res.body.error.code).toBe("courses.scope_unresolvable");
    });
  });
});
