// apps/api/test/integration/crm-admin-roles-priv-escalation.integration-spec.ts
//
// P1 CRM-core integration coverage (qa-engineer, Wave 5, docs/plans/phase-1.md task #8)
// for admin/roles + admin/branches: CRUD happy-path, the PRIVILEGE-ESCALATION GUARD
// (criterion #6), and the RBAC deny-by-default matrix for roles.*/branches.* (criterion
// #4). Run against REAL Postgres + Redis and the REAL Nest AppModule.
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

describeIfAvailable("CRM admin/roles + admin/branches (CRUD, privilege-escalation guard, RBAC matrix)", () => {
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
    NARROW_ROLE_EDITOR_EMAIL,
    NARROW_ROLE_EDITOR_PASSWORD,
  } = require("../fixtures/crm-fixtures");

  let app: import("@nestjs/common").INestApplication;
  let prisma: import("@prisma/client").PrismaClient;
  let fixtures: Awaited<ReturnType<typeof seedCrmFixtures>>;

  // qa-engineer Wave 5 fix (docs/plans/phase-9-completion.md T41, item 3 — integration-
  // suite flakiness): the "PUT /crm/admin/roles/:id/permissions — privilege-escalation
  // guard" describe block below mutates the REAL, SHARED "support" role's live
  // permission grants (`fixtures.rolesByKey["support"]` resolves to the SAME row every
  // other integration-spec file's fixtures/seed.ts reuse by key — it is not a role this
  // file creates) — the endpoint is a REPLACE-semantics PUT, so a successful grant call
  // here (e.g. `{ grants: [{ permissionKey: "students.export", scope: "branch" }] }`)
  // overwrote the role's ENTIRE grant set, wiping `tickets.edit`/`tickets.assign`/
  // `tickets.close`/`canned_responses.manage` that `prisma/seed.ts` had granted for the
  // support-desk module — observed causing phase-9-tickets.integration-spec.ts to fail
  // with 403 whenever it ran in the SAME suite AFTER this file, an ordering-dependent
  // failure with no fault in phase-9-tickets itself. Snapshot the support role's grants
  // before this file's own beforeAll seeds/mutates anything, and restore them exactly in
  // afterAll (same "clean up only what you touched, but here that includes RESTORING a
  // shared row this file intentionally overwrote" principle as the p4-learning-depth
  // certificate-template teardown fix).
  let supportRoleGrantsSnapshot: { permissionId: string; scope: string }[] = [];

  async function snapshotRolePermissions(roleId: string): Promise<{ permissionId: string; scope: string }[]> {
    return prisma.rolePermission.findMany({
      where: { roleId, deletedAt: null },
      select: { permissionId: true, scope: true },
    });
  }

  async function restoreRolePermissions(
    roleId: string,
    snapshot: { permissionId: string; scope: string }[],
  ): Promise<void> {
    const snapshotPermissionIds = new Set(snapshot.map((s) => s.permissionId));
    const current = await prisma.rolePermission.findMany({
      where: { roleId, deletedAt: null },
      select: { id: true, permissionId: true },
    });
    // Remove anything THIS run's tests granted that wasn't there originally.
    const toRemove = current.filter((row: { permissionId: string }) => !snapshotPermissionIds.has(row.permissionId));
    if (toRemove.length) {
      await prisma.rolePermission.deleteMany({ where: { id: { in: toRemove.map((r: { id: string }) => r.id) } } });
    }
    // Restore every originally-granted (permissionId, scope) pair exactly.
    for (const s of snapshot) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: s.permissionId } },
        create: { roleId, permissionId: s.permissionId, scope: s.scope as never },
        update: { scope: s.scope as never, deletedAt: null },
      });
    }
  }

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
    supportRoleGrantsSnapshot = await snapshotRolePermissions(fixtures.rolesByKey["support"]);

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
    if (fixtures?.rolesByKey?.["support"]) {
      await restoreRolePermissions(fixtures.rolesByKey["support"], supportRoleGrantsSnapshot).catch(() => {});
    }
    await teardownCrmFixtures(prisma, fixtures.tenantId);
    await prisma?.$disconnect();
  });

  // ── 1. roles CRUD ──────────────────────────────────────────────────────────────────────

  describe("roles CRUD (super_admin, scope=all)", () => {
    const key = `qa_crud_role_${Date.now()}`;
    let roleId: string;

    it("POST /crm/admin/roles creates a role", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/admin/roles")
        .set(authHeaders(accessToken, csrfToken))
        .send({ key, name: "QA CRUD Role" })
        .expect(201);
      roleId = res.body.data.id;
      expect(res.body.data.key).toBe(key);
      expect(res.body.data.isSystem).toBe(false);
    });

    it("GET /crm/admin/roles lists it; PATCH renames it", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const list = await request(app.getHttpServer())
        .get("/api/v1/crm/admin/roles")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      expect(list.body.data.some((r: { id: string }) => r.id === roleId)).toBe(true);

      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/crm/admin/roles/${roleId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "QA CRUD Role Renamed" })
        .expect(200);
      expect(patch.body.data.name).toBe("QA CRUD Role Renamed");
    });

    it("system roles (super_admin) cannot be renamed -> 403 roles.system_role_immutable", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const superAdminRole = fixtures.rolesByKey["super_admin"];
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/admin/roles/${superAdminRole}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: "Hacked Name" })
        .expect(403);
      expect(res.body.error.code).toBe("roles.system_role_immutable");
    });
  });

  // ── 6. PRIVILEGE-ESCALATION GUARD ─────────────────────────────────────────────────────

  describe("PUT /crm/admin/roles/:id/permissions — privilege-escalation guard (criterion #6)", () => {
    it("a legit IN-SCOPE grant succeeds: super_admin (holds everything at scope=all) can grant any permission at any scope", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const targetRoleId = fixtures.rolesByKey["support"];

      const res = await request(app.getHttpServer())
        .put(`/api/v1/crm/admin/roles/${targetRoleId}/permissions`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ grants: [{ permissionKey: "students.export", scope: "branch" }] })
        .expect(200);

      expect(res.body.data.grants).toEqual(
        expect.arrayContaining([{ permissionKey: "students.export", scope: "branch" }]),
      );
    });

    it("the editor CANNOT grant a permission key they do not hold at all -> 403 roles.privilege_escalation", async () => {
      const { accessToken, csrfToken } = await loginAs(NARROW_ROLE_EDITOR_EMAIL, NARROW_ROLE_EDITOR_PASSWORD);
      const targetRoleId = fixtures.rolesByKey["support"];

      // The narrow-role-editor fixture holds ONLY roles.edit/roles.view at scope=branch —
      // it does not hold students.* at all.
      const res = await request(app.getHttpServer())
        .put(`/api/v1/crm/admin/roles/${targetRoleId}/permissions`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ grants: [{ permissionKey: "students.delete", scope: "own" }] })
        .expect(403);
      expect(res.body.error.code).toBe("roles.privilege_escalation");
    });

    it("the editor CANNOT grant a BROADER scope than their own for a key they DO hold -> 403 roles.privilege_escalation", async () => {
      const { accessToken, csrfToken } = await loginAs(NARROW_ROLE_EDITOR_EMAIL, NARROW_ROLE_EDITOR_PASSWORD);
      const targetRoleId = fixtures.rolesByKey["support"];

      // The narrow-role-editor holds roles.edit at scope=branch — attempting to grant
      // roles.edit at scope=all (broader: all=4 > branch=3) must be rejected.
      const res = await request(app.getHttpServer())
        .put(`/api/v1/crm/admin/roles/${targetRoleId}/permissions`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ grants: [{ permissionKey: "roles.edit", scope: "all" }] })
        .expect(403);
      expect(res.body.error.code).toBe("roles.privilege_escalation");

      // Confirm the target role's grants were NOT mutated by the rejected attempt.
      const after = await prisma.rolePermission.findMany({
        where: { roleId: targetRoleId },
        include: { permission: true },
      });
      expect(after.some((g: { permission: { key: string }; scope: string }) => g.permission.key === "roles.edit" && g.scope === "all")).toBe(
        false,
      );
    });

    it("the editor CAN grant an EQUAL-or-narrower scope for a key they hold -> 200", async () => {
      const { accessToken, csrfToken } = await loginAs(NARROW_ROLE_EDITOR_EMAIL, NARROW_ROLE_EDITOR_PASSWORD);
      const targetRoleId = fixtures.rolesByKey["support"];

      const res = await request(app.getHttpServer())
        .put(`/api/v1/crm/admin/roles/${targetRoleId}/permissions`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ grants: [{ permissionKey: "roles.view", scope: "branch" }] })
        .expect(200);
      expect(res.body.data.grants).toEqual(expect.arrayContaining([{ permissionKey: "roles.view", scope: "branch" }]));
    });

    it("audit-on-mutation: a successful permission-matrix update writes a Role audit row with before/after grants", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const targetRoleId = fixtures.rolesByKey["support"];

      await request(app.getHttpServer())
        .put(`/api/v1/crm/admin/roles/${targetRoleId}/permissions`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ grants: [{ permissionKey: "students.export", scope: "branch" }] })
        .expect(200);

      const audit = await prisma.auditLog.findFirst({
        where: { entity: "Role", entityId: targetRoleId },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeTruthy();
      expect(audit!.before).toBeDefined();
      expect(audit!.after).toBeDefined();
    });
  });

  // ── 4. RBAC deny-by-default for roles.*/branches.* ────────────────────────────────────

  describe("RBAC deny-by-default for admin/roles + admin/branches", () => {
    it("counsellor (no roles.* grant) hitting GET /crm/admin/roles is 403", async () => {
      const { accessToken, csrfToken } = await loginAs(COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/admin/roles")
        .set(authHeaders(accessToken, csrfToken))
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");
    });

    it("counsellor (no branches.* grant) hitting GET /crm/admin/branches is 403", async () => {
      const { accessToken, csrfToken } = await loginAs(COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/admin/branches")
        .set(authHeaders(accessToken, csrfToken))
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");
    });

    it("counsellor PUT /crm/admin/roles/:id/permissions is 403 (forbidden action blocked + auditable trail check: no Role audit row is created by this rejected attempt)", async () => {
      const { accessToken, csrfToken } = await loginAs(COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD);
      const targetRoleId = fixtures.rolesByKey["faculty"];

      const before = await prisma.auditLog.count({ where: { entity: "Role", entityId: targetRoleId } });

      await request(app.getHttpServer())
        .put(`/api/v1/crm/admin/roles/${targetRoleId}/permissions`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ grants: [{ permissionKey: "students.delete", scope: "all" }] })
        .expect(403);

      const after = await prisma.auditLog.count({ where: { entity: "Role", entityId: targetRoleId } });
      // A 403 from the PermissionsGuard happens BEFORE the service/audit write is ever
      // reached — no spurious Role audit row should appear from a request that never
      // reached the business logic.
      expect(after).toBe(before);
    });
  });

  // ── branches CRUD (admin-only, scope=all) ─────────────────────────────────────────────

  describe("branches CRUD (super_admin, scope=all)", () => {
    let branchId: string;

    it("POST /crm/admin/branches creates a branch", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/admin/branches")
        .set(authHeaders(accessToken, csrfToken))
        .send({ name: `QA CRUD Branch ${Date.now()}`, city: "Mumbai", status: "active" })
        .expect(201);
      branchId = res.body.data.id;
    });

    it("GET by id + PATCH works", async () => {
      const { accessToken, csrfToken } = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      await request(app.getHttpServer())
        .get(`/api/v1/crm/admin/branches/${branchId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const patch = await request(app.getHttpServer())
        .patch(`/api/v1/crm/admin/branches/${branchId}`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ city: "Navi Mumbai" })
        .expect(200);
      expect(patch.body.data.city).toBe("Navi Mumbai");
    });
  });
});
