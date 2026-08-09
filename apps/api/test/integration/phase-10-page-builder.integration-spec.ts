// apps/api/test/integration/phase-10-page-builder.integration-spec.ts
//
// Phase-10 Page Builder + SiteSetting integration + RBAC test (docs/specs/
// phase-10-page-builder.md). Exercises the REAL NestJS application over HTTP (supertest
// + real Nest app) against a real Postgres + Redis DB, matching
// phase-9-content.integration-spec.ts's pattern.
//
// COVERAGE:
//   - Reserved-slug denylist -> 409 at create time (Edge case #8).
//   - super_admin-only RBAC: content_editor (holds content.edit/content.publish, NOT
//     content.builder) is 403'd on every builder endpoint AND every site-settings
//     endpoint (the deliberate narrowing this phase adds).
//   - AC 12: a malformed block (hero missing required `headline`) -> 400 with a
//     field-level error, no partial write.
//   - Save-before-apply version snapshot semantics (AC 6) + optimistic-concurrency 409
//     on a stale expectedVersion (Edge case #5).
//   - L2 (security review): reverting to a snapshot that no longer parses against the
//     current block registry -> 422 content.builder.version_no_longer_valid, live row
//     untouched, no new version appended.
//   - SECURITY FIX (M2, UNCONDITIONAL, tightened per Wave security review): the generic
//     PATCH/publish/DELETE endpoints are blocked on a builder-managed row for EVERY
//     caller, including super_admin (who holds content.builder) — no exception; every
//     builder edit must go through the versioned /builder endpoints.
//   - Revert creates a NEW version (append-only history, AC 7) and the reverted content
//     goes live immediately, visible on the public read path.
//   - SiteSetting: runtime keyed-value validation (400 for a bad shape, 404 for an
//     unknown key) and the public read surface. P10-2 (real-user defect promoted from
//     follow-up): `stats.headline` was REMOVED entirely — `apps/web` never actually
//     consumed it (the homepage stat trio comes from the `home` page's Page Builder
//     `stat_group` block instead), so editing it in the CRM saved successfully but
//     changed nothing on the live site. Every "8 keys"/"stats.headline" assertion below
//     is now "7 keys"/"stats.headline is gone" instead.

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

describeIfAvailable("Phase-10 Page Builder + SiteSetting — integration + RBAC (real Postgres + Redis)", () => {
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
  let superAdminCookies: string[], csrfSuperAdmin: string;
  let contentEditorCookies: string[], csrfContentEditor: string;

  const fixtureUserIds: string[] = [];
  const fixtureContentPageIds: string[] = [];
  const fixtureSlug = `p10-builder-${suffix}`;
  /** Captured before this suite mutates the SHARED `contact.details` seed row, so afterAll can restore it — SiteSetting is a singleton-per-tenant row other suites may read. */
  let originalContactDetailsValue: unknown;

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

    const superAdminRole = await prisma.role.findFirst({ where: { tenantId, key: "super_admin", deletedAt: null } });
    const contentEditorRole = await prisma.role.findFirst({ where: { tenantId, key: "content_editor", deletedAt: null } });
    if (!superAdminRole || !contentEditorRole) throw new Error("Roles not seeded — run `pnpm db:seed` first.");

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string, roleId: string): Promise<string> {
      const email = `p10builder.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({ data: { tenantId, email, name: `P10 Builder ${label}`, passwordHash: pwHash, status: "active" } });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId: null } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    await createUser("superAdmin", superAdminRole.id);
    await createUser("contentEditor", contentEditorRole.id);

    ({ cookies: superAdminCookies, csrf: csrfSuperAdmin } = await login(`p10builder.superAdmin.${suffix}@test.com`, PASSWORD));
    ({ cookies: contentEditorCookies, csrf: csrfContentEditor } = await login(`p10builder.contentEditor.${suffix}@test.com`, PASSWORD));

    const contactDetailsRow = await prisma.siteSetting.findFirst({ where: { tenantId, key: "contact.details", deletedAt: null } });
    originalContactDetailsValue = contactDetailsRow?.value;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      if (originalContactDetailsValue !== undefined) {
        await prisma.siteSetting.updateMany({ where: { tenantId, key: "contact.details" }, data: { value: originalContactDetailsValue } }).catch(() => {});
      }
      await prisma.contentPageVersion.deleteMany({ where: { contentPageId: { in: fixtureContentPageIds } } }).catch(() => {});
      await prisma.contentPage.deleteMany({ where: { id: { in: fixtureContentPageIds } } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // RBAC: content_editor (content.edit/.publish, NOT content.builder) is 403'd everywhere
  // ═══════════════════════════════════════════════════════════════════════

  describe("RBAC: content_editor lacks content.builder — 403 on every builder endpoint", () => {
    it("403s on POST /crm/content-pages/builder", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/content-pages/builder")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ slug: `should-not-be-created-${suffix}`, title: "Nope" });
      expect(res.status).toBe(403);
    });

    it("403s on GET /crm/content-pages/:id/versions (an arbitrary id — permission check happens before the id is even resolved)", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/crm/content-pages/00000000-0000-0000-0000-000000000000/versions`)
        .set("Cookie", cookieHeader(contentEditorCookies));
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Marketing image uploads (POST /crm/content-pages/media-upload-url)
  // ═══════════════════════════════════════════════════════════════════════

  describe("POST /crm/content-pages/media-upload-url", () => {
    it("200s for super_admin with a valid body — returns a signed upload URL + a marketing_images-namespaced storageKey", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/content-pages/media-upload-url")
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ fileName: "hero.webp", contentType: "image/webp", sizeBytes: 1_000_000 });
      expect(res.status).toBe(200);
      expect(res.body.data.storageKey).toMatch(/^marketing_images\//);
      expect(typeof res.body.data.uploadUrl).toBe("string");
      expect(res.body.data.maxSizeBytes).toBe(1_000_000);
    });

    it("403s for content_editor (holds content.edit/.publish, not content.builder)", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/content-pages/media-upload-url")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ fileName: "hero.webp", contentType: "image/webp", sizeBytes: 1_000_000 });
      expect(res.status).toBe(403);
    });

    it("400s for contentType='image/svg+xml' — not in the closed raster-image enum (stored-XSS vector on the public site)", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/content-pages/media-upload-url")
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ fileName: "evil.svg", contentType: "image/svg+xml", sizeBytes: 1000 });
      expect(res.status).toBe(400);
    });

    it("400s for sizeBytes over the 5 MB cap", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/content-pages/media-upload-url")
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ fileName: "huge.png", contentType: "image/png", sizeBytes: 5_242_881 });
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Reserved-slug denylist (Edge case #8)
  // ═══════════════════════════════════════════════════════════════════════

  it("super_admin creating a builder page at a reserved slug (e.g. 'about') -> 409 content.builder.slug_reserved", async () => {
    const res = await request(httpServer)
      .post("/api/v1/crm/content-pages/builder")
      .set("Cookie", cookieHeader(superAdminCookies))
      .set("X-CSRF-Token", csrfSuperAdmin)
      .send({ slug: "about", title: "Should collide with the hardcoded /about route" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("content.builder.slug_reserved");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Create -> save -> concurrency conflict -> versions -> revert -> public read
  // ═══════════════════════════════════════════════════════════════════════

  describe("super_admin: create -> save (version snapshot) -> concurrency 409 -> versions -> revert -> public read", () => {
    let pageId: string;

    it("creates an empty (body=[]) builder page, status=published, currentVersion=0", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/content-pages/builder")
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ slug: fixtureSlug, title: "P10 Builder Test Page" });
      expect(res.status).toBe(201);
      expect(res.body.data.isBuilderManaged).toBe(true);
      expect(res.body.data.status).toBe("published");
      expect(res.body.data.body).toEqual([]);
      expect(res.body.data.currentVersion).toBe(0);
      pageId = res.body.data.id;
      fixtureContentPageIds.push(pageId);

      // No version row exists yet — bare creation does not snapshot (spec: "no version
      // row is created on bare creation").
      const versionCount = await prisma.contentPageVersion.count({ where: { contentPageId: pageId } });
      expect(versionCount).toBe(0);
    });

    it("AC12: PUT .../builder with a malformed block (hero missing required headline) -> 400 with a field-level error naming the block/field, no partial write", async () => {
      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${pageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: [{ type: "hero", data: {} }], expectedVersion: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("validation.failed");
      expect(Array.isArray(res.body.error.errors)).toBe(true);
      expect(res.body.error.errors.length).toBeGreaterThan(0);
      // Field-level error names the offending field (AC 12: "naming the block and field").
      expect(res.body.error.errors.some((e: { path: string }) => e.path.includes("headline"))).toBe(true);

      // No partial write: still no version row, page body untouched.
      const versionCount = await prisma.contentPageVersion.count({ where: { contentPageId: pageId } });
      expect(versionCount).toBe(0);
      const row = await prisma.contentPage.findUnique({ where: { id: pageId } });
      expect(row.body).toEqual([]);
    });

    it("first save (expectedVersion=0) creates version 1, applies the new content live", async () => {
      const body = {
        title: "P10 Builder Test Page",
        body: [{ type: "brain_showcase", data: {} }],
        expectedVersion: 0,
      };
      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${pageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body.data.currentVersion).toBe(1);
      expect(res.body.data.body).toEqual(body.body);

      const versionRow = await prisma.contentPageVersion.findFirst({ where: { contentPageId: pageId, version: 1 } });
      expect(versionRow).not.toBeNull();
      // save-before-apply: version 1 snapshots the PRE-mutation state (body=[]), not the
      // just-applied content.
      expect(versionRow!.body).toEqual([]);

      const auditRow = await prisma.auditLog.findFirst({ where: { tenantId, entity: "ContentPageVersion", entityId: versionRow!.id, action: "create" } });
      expect(auditRow).not.toBeNull();
    });

    it("re-saving with the SAME (now-stale) expectedVersion=0 -> 409 content.builder.version_conflict", async () => {
      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${pageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: [{ type: "brain_showcase", data: {} }], expectedVersion: 0 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("content.builder.version_conflict");
    });

    it("preview (unsaved edits) resolves live_collection_ref blocks WITHOUT persisting or bumping the version", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/crm/content-pages/${pageId}/preview`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({
          body: [
            { type: "live_collection_ref", data: { collection: "mentors", layout: "grid-4", selection: { limit: 4 } } },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.blocks).toHaveLength(1);
      expect(res.body.data.blocks[0].data).toHaveProperty("resolvedItems");

      const versionCount = await prisma.contentPageVersion.count({ where: { contentPageId: pageId } });
      expect(versionCount).toBe(1); // unchanged — preview never persists
    });

    it("second save (expectedVersion=1) creates version 2", async () => {
      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${pageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: [{ type: "hero", data: { headline: "Second save headline" } }], expectedVersion: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.currentVersion).toBe(2);
    });

    it("GET /versions lists version 1 and 2, newest-first, metadata-only (no body field)", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/crm/content-pages/${pageId}/versions`)
        .set("Cookie", cookieHeader(superAdminCookies));
      expect(res.status).toBe(200);
      expect(res.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      expect(res.body.data[0]).not.toHaveProperty("body");
    });

    it("GET /versions/1 returns the full body snapshot", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/crm/content-pages/${pageId}/versions/1`)
        .set("Cookie", cookieHeader(superAdminCookies));
      expect(res.status).toBe(200);
      expect(res.body.data.body).toEqual([]);
    });

    it("revert to version 1 (expectedVersion=2) creates version 3, and history is append-only (v1/v2 still exist)", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/crm/content-pages/${pageId}/versions/1/revert`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ expectedVersion: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data.currentVersion).toBe(3);
      expect(res.body.data.body).toEqual([]); // v1's content (empty body) is now live

      const versionCount = await prisma.contentPageVersion.count({ where: { contentPageId: pageId } });
      expect(versionCount).toBe(3); // v1 and v2 were NOT deleted/rewound
    });

    it("the public read path reflects the reverted content on its next request", async () => {
      const res = await request(httpServer).get(`/api/v1/public/pages/${fixtureSlug}`);
      expect(res.status).toBe(200);
      expect(res.body.data.isBuilderManaged).toBe(true);
      expect(res.body.data.body).toEqual([]);
    });

    it("L2 (security review): reverting to a snapshot whose body no longer parses -> 422 content.builder.version_no_longer_valid, live row untouched, no new version appended", async () => {
      // The API itself can never WRITE an invalid snapshot (save() always validates
      // first) — this row is inserted DIRECTLY to simulate a legacy snapshot written
      // before the block registry tightened (or a since-corrupted row), so the
      // revert-time re-validation guard (content-pages-builder.service.ts) has something
      // to reject.
      const currentVersionCount = await prisma.contentPageVersion.count({ where: { contentPageId: pageId } });
      const corruptedVersion = currentVersionCount + 1;
      await prisma.contentPageVersion.create({
        data: {
          tenantId,
          contentPageId: pageId,
          version: corruptedVersion,
          title: "Corrupted snapshot",
          body: [{ type: "hero", data: {} }], // missing required `headline` — no longer parses.
          createdById: fixtureUserIds[0],
        },
      });

      const beforeRow = await prisma.contentPage.findUnique({ where: { id: pageId } });

      const res = await request(httpServer)
        .post(`/api/v1/crm/content-pages/${pageId}/versions/${corruptedVersion}/revert`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ expectedVersion: corruptedVersion });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("content.builder.version_no_longer_valid");

      const afterRow = await prisma.contentPage.findUnique({ where: { id: pageId } });
      expect(new Date(afterRow.updatedAt).getTime()).toBe(new Date(beforeRow.updatedAt).getTime());
      const versionCountAfter = await prisma.contentPageVersion.count({ where: { contentPageId: pageId } });
      expect(versionCountAfter).toBe(corruptedVersion); // unchanged — the failed revert appended NOTHING
    });

    it("SECURITY FIX: content_editor (content.edit, no content.builder) is 403'd on the GENERIC PATCH endpoint for this builder-managed page", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/content-pages/${pageId}`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ title: "Hijacked via generic endpoint" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("content.builder_managed_forbidden");

      // Confirm the row was NOT mutated.
      const row = await prisma.contentPage.findUnique({ where: { id: pageId } });
      expect(row.title).not.toBe("Hijacked via generic endpoint");
    });

    it("SECURITY FIX (M2, UNCONDITIONAL): super_admin — who DOES hold content.builder — is ALSO 403'd on the generic PATCH endpoint; every builder edit must go through /builder", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/content-pages/${pageId}`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ title: "Hijacked via generic endpoint by super_admin" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("content.builder_managed_forbidden");

      const row = await prisma.contentPage.findUnique({ where: { id: pageId } });
      expect(row.title).not.toBe("Hijacked via generic endpoint by super_admin");
    });

    it("SECURITY FIX (M2, UNCONDITIONAL): super_admin is ALSO 403'd on POST :id/publish and DELETE :id for a builder-managed page", async () => {
      const publishRes = await request(httpServer)
        .post(`/api/v1/crm/content-pages/${pageId}/publish`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin);
      expect(publishRes.status).toBe(403);
      expect(publishRes.body.error.code).toBe("content.builder_managed_forbidden");

      const deleteRes = await request(httpServer)
        .delete(`/api/v1/crm/content-pages/${pageId}`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin);
      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.error.code).toBe("content.builder_managed_forbidden");

      // Confirm the page still exists (was NOT deleted).
      const row = await prisma.contentPage.findUnique({ where: { id: pageId } });
      expect(row).not.toBeNull();
      expect(row.deletedAt).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SiteSetting
  // ═══════════════════════════════════════════════════════════════════════

  describe("SiteSetting: CRM CRUD (super_admin-only) + public read", () => {
    it("content_editor is 403'd on GET /crm/site-settings (does not hold site_settings.view)", async () => {
      const res = await request(httpServer).get("/api/v1/crm/site-settings").set("Cookie", cookieHeader(contentEditorCookies));
      expect(res.status).toBe(403);
    });

    it("super_admin lists exactly the 8 seeded site settings (P10-2: stats.headline was REMOVED)", async () => {
      const res = await request(httpServer).get("/api/v1/crm/site-settings").set("Cookie", cookieHeader(superAdminCookies));
      expect(res.status).toBe(200);
      const keys = res.body.data.map((s: { key: string }) => s.key);
      // 8, not 7: `announcement.bar` (the CRM-toggleable strip above the site header) was added
      // after this assertion was written. The exact count is asserted on purpose — it is what
      // catches a setting appearing that no one declared — so it has to move with the seed.
      expect(keys).toEqual(
        expect.arrayContaining(["nav.primary_links", "footer.columns", "footer.legal_links", "footer.copyright_text", "seo.defaults", "contact.details", "contact.whatsapp", "announcement.bar"]),
      );
      expect(keys).not.toContain("stats.headline");
      expect(res.body.data.length).toBe(8);
    });

    it("GET /crm/site-settings/:key 404s for an unknown key", async () => {
      const res = await request(httpServer).get("/api/v1/crm/site-settings/not.a.real.key").set("Cookie", cookieHeader(superAdminCookies));
      expect(res.status).toBe(404);
    });

    it("GET /crm/site-settings/stats.headline 404s (P10-2: the key was REMOVED, not just left empty)", async () => {
      const res = await request(httpServer).get("/api/v1/crm/site-settings/stats.headline").set("Cookie", cookieHeader(superAdminCookies));
      expect(res.status).toBe(404);
    });

    it("PUT /crm/site-settings/stats.headline 404s — cannot be re-created (P10-2)", async () => {
      const res = await request(httpServer)
        .put("/api/v1/crm/site-settings/stats.headline")
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ value: [{ key: "feature", label: "Students trained", value: "20,000+", description: "Should not be creatable." }] });
      expect(res.status).toBe(404);
    });

    it("PUT /crm/site-settings/:key 400s when value fails the key's closed shape", async () => {
      const res = await request(httpServer)
        .put("/api/v1/crm/site-settings/nav.primary_links")
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ value: { not: "an array of nav links" } });
      expect(res.status).toBe(400);
    });

    it("PUT /crm/site-settings/:key upserts a valid value, and it appears on the next GET", async () => {
      const newContactDetails = { contactText: "Updated by integration test." };
      const putRes = await request(httpServer)
        .put("/api/v1/crm/site-settings/contact.details")
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ value: newContactDetails });
      expect(putRes.status).toBe(200);
      expect(putRes.body.data.value).toEqual(newContactDetails);

      const auditRow = await prisma.auditLog.findFirst({ where: { tenantId, entity: "SiteSetting", action: "update" }, orderBy: { createdAt: "desc" } });
      expect(auditRow).not.toBeNull();
    });

    it("GET /public/site-settings is anonymous and returns exactly the 8 keys (never stats.headline — P10-2), reflecting the just-updated value", async () => {
      const res = await request(httpServer).get("/api/v1/public/site-settings");
      expect(res.status).toBe(200);
      // NOTE: jest's toHaveProperty() treats a dotted string as a NESTED keypath, not a
      // literal key — these keys literally CONTAIN dots ("nav.primary_links"), so we
      // check membership directly rather than via toHaveProperty().
      const keys = Object.keys(res.body.data);
      expect(keys).toEqual(
        expect.arrayContaining(["nav.primary_links", "footer.columns", "footer.legal_links", "footer.copyright_text", "seo.defaults", "contact.details", "contact.whatsapp", "announcement.bar"]),
      );
      expect(keys).not.toContain("stats.headline");
      expect(keys).toHaveLength(8);
      expect(res.body.data["contact.details"].contactText).toBe("Updated by integration test.");
    });
  });
});
