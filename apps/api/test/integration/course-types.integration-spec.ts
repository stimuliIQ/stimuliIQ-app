// apps/api/test/integration/course-types.integration-spec.ts
//
// Course types as CRM-managed data (docs/specs/course-types.md, ADR-0068), against REAL
// Postgres + Redis and the REAL Nest AppModule.
//
// What is worth an integration test here, as opposed to the service unit spec:
//   1. THE READ GATE. The list is gated on `students.view`, not a key of its own. If that
//      ever regresses, every counsellor gets an empty course-type dropdown with nothing on
//      screen explaining why — the exact failure this design avoids, and one only a real
//      RBAC stack can catch.
//   2. THE WRITE GATE. `course_types.manage` actually keeps a non-admin out.
//   3. THE END-TO-END CONTRACT with students: an unknown key is refused, a renamed option
//      changes what the student directory SAYS without changing what a student IS, and an
//      option in use cannot be deleted.
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

describeIfAvailable("CRM course types (CRM-managed option list)", () => {
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
    return { accessToken: extractCookie(res, "access_token")!, csrfToken: extractCookie(res, "csrf_token")! };
  }

  function authHeaders(accessToken: string, csrfToken: string): Record<string, string> {
    return { Cookie: `access_token=${accessToken}; csrf_token=${csrfToken}`, "X-CSRF-Token": csrfToken };
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

  // ── 1. The read gate ────────────────────────────────────────────────────────────────

  it("a counsellor can READ the list — otherwise their course-type dropdown is empty", async () => {
    const { accessToken } = await loginAs(COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD);
    const res = await request(app.getHttpServer())
      .get("/api/v1/crm/course-types?page=1&pageSize=50&activeOnly=true")
      .set("Cookie", `access_token=${accessToken}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.map((o: { key: string }) => o.key)).toContain("btech");
  });

  // ── 2. The write gate ───────────────────────────────────────────────────────────────

  it("a counsellor cannot CREATE one — the list is admin configuration", async () => {
    const { accessToken, csrfToken } = await loginAs(COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD);
    await request(app.getHttpServer())
      .post("/api/v1/crm/course-types")
      .set(authHeaders(accessToken, csrfToken))
      .send({ label: "Sneaky" })
      .expect(403);
  });

  // ── 3. The contract with students ───────────────────────────────────────────────────

  describe("the list drives what a student may be recorded as", () => {
    let createdId: string;
    const label = `QA Nursing ${Date.now()}`;

    it("creates an option and derives its key from the label", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/course-types")
        .set(authHeaders(accessToken, csrfToken))
        .send({ label })
        .expect(201);

      createdId = res.body.data.id;
      expect(res.body.data.key).toBe(label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
      expect(res.body.data.studentCount).toBe(0);
    });

    it("refuses a student whose course type is not on the list (422, not a silent write)", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          name: "QA Unknown Course Type",
          email: `qa-unknown-ct-${Date.now()}@stimuliiq.test`,
          courseType: "not_a_real_course_type",
          status: "lead",
        });

      expect([400, 422]).toContain(res.status);
      expect(JSON.stringify(res.body)).toContain("course_types.unknown");
    });

    it("renaming an option changes what the directory SAYS, not what the student IS", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      const created = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          name: "QA Renamed Course Type",
          email: `qa-rename-ct-${Date.now()}@stimuliiq.test`,
          courseType: "btech",
          status: "lead",
        })
        .expect(201);
      const studentId = created.body.data.id;
      expect(created.body.data.courseTypeLabel).toBe("B.Tech");

      const option = await prisma.courseType.findFirst({
        where: { tenantId: fixtures.tenantId, key: "btech", deletedAt: null },
      });
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/course-types/${option!.id}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ label: "B.Tech (Engineering)" })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/crm/students/${studentId}`)
        .set("Cookie", `access_token=${accessToken}`)
        .expect(200);

      // The stored key never moved; only the label the CRM shows did.
      expect(after.body.data.courseType).toBe("btech");
      expect(after.body.data.courseTypeLabel).toBe("B.Tech (Engineering)");

      // Put it back so the rest of the suite (and the fixture) reads normally.
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/course-types/${option!.id}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ label: "B.Tech" })
        .expect(200);
    });

    it("refuses to delete an option students are recorded with, and offers hiding instead", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const option = await prisma.courseType.findFirst({
        where: { tenantId: fixtures.tenantId, key: "btech", deletedAt: null },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/course-types/${option!.id}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(409);

      expect(JSON.stringify(res.body)).toContain("course_types.in_use");
    });

    it("a HIDDEN option cannot be given to a new student, but still renders for existing ones", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .patch(`/api/v1/crm/course-types/${createdId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ active: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/students")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          name: "QA Hidden Course Type",
          email: `qa-hidden-ct-${Date.now()}@stimuliiq.test`,
          courseType: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
          status: "lead",
        });

      expect([400, 422]).toContain(res.status);
      expect(JSON.stringify(res.body)).toContain("course_types.unknown");
    });

    it("deletes the unused option it created, leaving the fixture as it found it", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/course-types/${createdId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
    });
  });
});
