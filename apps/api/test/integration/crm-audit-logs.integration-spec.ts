// apps/api/test/integration/crm-audit-logs.integration-spec.ts
//
// P1 CRM-core integration coverage (qa-engineer, Wave 5, docs/plans/phase-1.md task #8)
// for the read-only GET /crm/audit-logs viewer — confirms filters (entity/entityId/
// actorId/action/from/to) actually narrow results, deny-by-default for callers without
// `audit_logs.view`, and that secrets never leak through this endpoint. Run against REAL
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

describeIfAvailable("GET /crm/audit-logs (filters, deny-by-default, secret redaction)", () => {
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
    COUNSELLOR_EMAIL,
    COUNSELLOR_PASSWORD,
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

  it("denies a caller without audit_logs.view -> 403 (counsellor has no audit_logs.* grant)", async () => {
    const { accessToken, csrfToken } = await loginAs(COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD);
    const res = await request(app.getHttpServer())
      .get("/api/v1/crm/audit-logs")
      .set(authHeaders(accessToken, csrfToken))
      .expect(403);
    expect(res.body.error.code).toBe("auth.forbidden");
  });

  it("entity + entityId filter narrows results to exactly the rows for that row", async () => {
    const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/crm/students")
      .set(authHeaders(accessToken, csrfToken))
      .send({
        name: "QA Audit Filter Student",
        email: `qa-audit-filter-${Date.now()}@stimuliiq.test`,
        courseType: "btech",
      })
      .expect(201);
    const studentId = createRes.body.data.id;

    const res = await request(app.getHttpServer())
      .get("/api/v1/crm/audit-logs")
      .query({ entity: "StudentProfile", entityId: studentId })
      .set(authHeaders(accessToken, csrfToken))
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.entity).toBe("StudentProfile");
      expect(row.entityId).toBe(studentId);
    }
  });

  it("action filter narrows to only that action", async () => {
    const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    const res = await request(app.getHttpServer())
      .get("/api/v1/crm/audit-logs")
      .query({ action: "delete", pageSize: 50 })
      .set(authHeaders(accessToken, csrfToken))
      .expect(200);

    for (const row of res.body.data) {
      expect(row.action).toBe("delete");
    }
  });

  it("actorId filter narrows to rows created by that actor", async () => {
    const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    const res = await request(app.getHttpServer())
      .get("/api/v1/crm/audit-logs")
      .query({ actorId: fixtures.superAdminUserId, pageSize: 50 })
      .set(authHeaders(accessToken, csrfToken))
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.actorId).toBe(fixtures.superAdminUserId);
    }
  });

  it("from/to date-range filter excludes rows outside the window", async () => {
    const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .get("/api/v1/crm/audit-logs")
      .query({ from: farFuture })
      .set(authHeaders(accessToken, csrfToken))
      .expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("never surfaces passwordHash/refreshHash even for User-entity rows", async () => {
    const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    const res = await request(app.getHttpServer())
      .get("/api/v1/crm/audit-logs")
      .query({ entity: "User", pageSize: 50 })
      .set(authHeaders(accessToken, csrfToken))
      .expect(200);

    const serialized = JSON.stringify(res.body.data);
    expect(serialized).not.toMatch(/passwordHash|password_hash/i);
    expect(serialized).not.toMatch(/refreshHash|refresh_hash/i);
  });
});
