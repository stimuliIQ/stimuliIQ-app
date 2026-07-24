// apps/api/test/integration/phase-11-locked-templates.integration-spec.ts
//
// Phase-11 Locked Page Templates + Colleges CRM — integration + RBAC test (docs/plans/
// phase-11-locked-templates.md; packages/types/src/content/page-templates.schemas.ts;
// packages/types/src/crm/colleges.schemas.ts). Exercises the REAL NestJS application over
// HTTP (supertest + real Nest app) against a real Postgres + Redis DB, matching
// phase-10-page-builder.integration-spec.ts's pattern (this file is that suite's Phase-11
// sibling: same fixture/app-bootstrap shape, new server-side-lock + Colleges coverage).
//
// COVERAGE:
//   - Server-side template lock on a REAL seeded core-template page (`gallery` —
//     `prisma/seed.ts`'s BUILDER_PAGES): a missing/extra/reordered section is rejected 422
//     `content.builder.template_violation` with NO version row created and the live row
//     untouched; a fully valid template body is accepted, versions, and is visible on the
//     public read path on the very next request.
//   - `seoImagePath` round-trips end-to-end: POST/PUT payload -> persisted column -> public
//     `GET /public/pages/:slug` -> the NEXT save's version snapshot (save-before-apply
//     captures the PRIOR seoImagePath, not the one just submitted).
//   - Colleges CRUD (`/crm/colleges`, a dedicated screen over `Partner` rows scoped to
//     `category="college_partner"`): create (category defaults + focus/established/city
//     persist) -> list (filtered OUT non-college partner rows) -> update (partial patch) ->
//     soft-delete (row survives with `deletedAt` set, disappears from the list), each with
//     an `audit_logs` row (entity="Partner", matching action).
//   - RBAC: `counsellor` (holds NO `content.*` permission) is 403'd on every
//     `/crm/colleges` verb; `content_editor` (holds content.view/create/edit/delete, same
//     grants `/crm/partners` already requires) succeeds — colleges reuse the SAME
//     permission keys, not a new `colleges.*` domain (crm/colleges.schemas.ts file header).
//   - Tenant-scope isolation: a `Partner` row seeded directly under a SECOND tenant is
//     invisible to tenant-A's `/crm/colleges` list/update/delete (proves the repository's
//     `tenantId` filter, not just a UI hide) — done without a second real login (this
//     codebase's `AuthService` hardcodes a single tenant slug for `/auth/login`, see
//     p6-engagement.integration-spec.ts's header note on why cross-tenant HTTP login isn't
//     used here).
//
// Restoration: the `gallery` ContentPage row is a SHARED seed fixture other suites/e2e
// specs read (`apps/web/e2e/page-builder-public-render.e2e.spec.ts` asserts its hero
// `aria-label`) — this file snapshots its exact pre-test `body`/title/SEO fields in
// `beforeAll` and force-restores them with a raw `prisma.contentPage.update` in `afterAll`
// (not a versioned save — simplest guarantee of exact restoration regardless of how many
// version rows this file's mutations created; those extra version rows are append-only
// history and harmless to leave behind, matching this suite's sibling's own convention of
// never deleting version rows).

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

describeIfAvailable("Phase-11 Locked Page Templates + Colleges CRM — integration + RBAC (real Postgres + Redis)", () => {
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
  let counsellorCookies: string[], csrfCounsellor: string;

  const fixtureUserIds: string[] = [];
  const fixturePartnerIds: string[] = [];
  let secondTenantId: string | undefined;
  let foreignTenantPartnerId: string | undefined;

  // Snapshot of the SHARED seeded "gallery" ContentPage row, captured in beforeAll and
  // restored verbatim in afterAll (see file header "Restoration").
  let galleryPageId: string;
  let galleryOriginal: { title: string; body: unknown; seoTitle: string | null; seoDescription: string | null; seoImagePath: string | null };
  let galleryVersionCountAtStart: number;

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
    const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
    if (!superAdminRole || !contentEditorRole || !counsellorRole) throw new Error("Roles not seeded — run `pnpm db:seed` first.");

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string, roleId: string): Promise<string> {
      const email = `p11locked.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({ data: { tenantId, email, name: `P11 Locked ${label}`, passwordHash: pwHash, status: "active" } });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId: null } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    await createUser("superAdmin", superAdminRole.id);
    await createUser("contentEditor", contentEditorRole.id);
    await createUser("counsellor", counsellorRole.id);

    ({ cookies: superAdminCookies, csrf: csrfSuperAdmin } = await login(`p11locked.superAdmin.${suffix}@test.com`, PASSWORD));
    ({ cookies: contentEditorCookies, csrf: csrfContentEditor } = await login(`p11locked.contentEditor.${suffix}@test.com`, PASSWORD));
    ({ cookies: counsellorCookies, csrf: csrfCounsellor } = await login(`p11locked.counsellor.${suffix}@test.com`, PASSWORD));

    const galleryRow = await prisma.contentPage.findFirst({ where: { tenantId, slug: "gallery", deletedAt: null } });
    if (!galleryRow) throw new Error("Seeded 'gallery' ContentPage not found — run `pnpm db:seed` first.");
    galleryPageId = galleryRow.id;
    galleryOriginal = { title: galleryRow.title, body: galleryRow.body, seoTitle: galleryRow.seoTitle, seoDescription: galleryRow.seoDescription, seoImagePath: galleryRow.seoImagePath };
    galleryVersionCountAtStart = await prisma.contentPageVersion.count({ where: { tenantId, contentPageId: galleryPageId } });

    // A SECOND tenant + a college-category Partner row under it — used only by the
    // tenant-scope isolation test below. Never logged into (see file header).
    const secondTenant = await prisma.tenant.create({
      data: { name: `P11 Locked Foreign Tenant ${suffix}`, slug: `p11-locked-foreign-${suffix}`, status: "active" },
    });
    secondTenantId = secondTenant.id;
    const foreignPartner = await prisma.partner.create({
      data: { tenantId: secondTenantId, name: "Foreign Tenant College", category: "college_partner", status: "published", order: 0 },
    });
    foreignTenantPartnerId = foreignPartner.id;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // Restore the shared "gallery" page's live content exactly (see file header).
      if (galleryPageId && galleryOriginal) {
        await prisma.contentPage
          .update({ where: { id: galleryPageId }, data: { ...galleryOriginal, status: "published" } })
          .catch(() => {});
      }
      await prisma.partner.deleteMany({ where: { id: { in: fixturePartnerIds } } }).catch(() => {});
      if (foreignTenantPartnerId) await prisma.partner.deleteMany({ where: { id: foreignTenantPartnerId } }).catch(() => {});
      if (secondTenantId) await prisma.tenant.deleteMany({ where: { id: secondTenantId } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // Server-side template lock — real seeded core-template page ("gallery")
  // ═══════════════════════════════════════════════════════════════════════

  describe("PUT /crm/content-pages/:id/builder — server-side template lock on a locked core-template page", () => {
    it("rejects a body missing a required section (only 'hero', 'gallery_grid' removed) -> 422 content.builder.template_violation, no version created, live row untouched", async () => {
      const before = await prisma.contentPage.findUnique({ where: { id: galleryPageId } });
      const heroOnly = [(before.body as Array<{ type: string; data: unknown }>)[0]];

      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${galleryPageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: heroOnly, expectedVersion: galleryVersionCountAtStart });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("content.builder.template_violation");

      const after = await prisma.contentPage.findUnique({ where: { id: galleryPageId } });
      expect(after.body).toEqual(before.body);
      const versionCount = await prisma.contentPageVersion.count({ where: { tenantId, contentPageId: galleryPageId } });
      expect(versionCount).toBe(galleryVersionCountAtStart);
    });

    it("rejects a body with an added/extra section appended -> 422, no version created", async () => {
      const before = await prisma.contentPage.findUnique({ where: { id: galleryPageId } });
      const withExtra = [...(before.body as Array<{ type: string; data: unknown }>), { type: "faq", data: { items: [{ question: "Q?", answer: "A." }] } }];

      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${galleryPageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: withExtra, expectedVersion: galleryVersionCountAtStart });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("content.builder.template_violation");

      const versionCount = await prisma.contentPageVersion.count({ where: { tenantId, contentPageId: galleryPageId } });
      expect(versionCount).toBe(galleryVersionCountAtStart);
    });

    it("rejects a body with sections reordered (gallery_grid before hero) -> 422, no version created", async () => {
      const before = await prisma.contentPage.findUnique({ where: { id: galleryPageId } });
      const body = before.body as Array<{ type: string; data: unknown }>;
      const reordered = [body[1], body[0]];

      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${galleryPageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: reordered, expectedVersion: galleryVersionCountAtStart });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("content.builder.template_violation");

      const versionCount = await prisma.contentPageVersion.count({ where: { tenantId, contentPageId: galleryPageId } });
      expect(versionCount).toBe(galleryVersionCountAtStart);
    });

    it("rejects a wrong-type section (hero slot replaced by a job_openings block) -> 422 naming the offending section", async () => {
      const before = await prisma.contentPage.findUnique({ where: { id: galleryPageId } });
      const body = before.body as Array<{ type: string; data: unknown }>;
      const wrongType = [{ type: "job_openings", data: { items: [] } }, body[1]];

      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${galleryPageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: wrongType, expectedVersion: galleryVersionCountAtStart });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("content.builder.template_violation");
      expect(Array.isArray(res.body.error.errors)).toBe(true);
      expect(res.body.error.errors.some((e: { code: string; key?: string }) => e.code === "wrong_block_type" && e.key === "hero")).toBe(true);
    });

    it("accepts a fully valid template body + a seoImagePath, versions, and the public read path reflects it on the next request", async () => {
      const before = await prisma.contentPage.findUnique({ where: { id: galleryPageId } });
      const body = before.body as Array<{ type: string; data: Record<string, unknown> }>;
      const newHeadline = `QA locked-template headline ${suffix}`;
      const editedBody = [{ ...body[0], data: { ...body[0]!.data, headline: newHeadline } }, body[1]];
      const seoImagePathA = `marketing_images/${tenantId}/qa-og-a-${suffix}.webp`;

      const res = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${galleryPageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: editedBody, seoImagePath: seoImagePathA, expectedVersion: galleryVersionCountAtStart });
      expect(res.status).toBe(200);
      expect(res.body.data.currentVersion).toBe(galleryVersionCountAtStart + 1);
      expect(res.body.data.seoImagePath).toBe(seoImagePathA);

      // AC "save is live": the public read path reflects the new headline + seoImagePath
      // on the very next request, no separate publish step.
      const publicRes = await request(httpServer).get("/api/v1/public/pages/gallery");
      expect(publicRes.status).toBe(200);
      expect(publicRes.body.data.body[0].data.headline).toBe(newHeadline);
      expect(publicRes.body.data.seoImagePath).toBe(seoImagePathA);

      // A second save captures the FIRST save's seoImagePath in ITS version snapshot
      // (save-before-apply — the snapshot is always "what it looked like right before
      // this save", never the just-submitted content).
      const seoImagePathB = `marketing_images/${tenantId}/qa-og-b-${suffix}.webp`;
      const secondHeadline = `QA locked-template headline v2 ${suffix}`;
      const secondBody = [{ ...editedBody[0], data: { ...editedBody[0]!.data, headline: secondHeadline } }, body[1]];
      const secondRes = await request(httpServer)
        .put(`/api/v1/crm/content-pages/${galleryPageId}/builder`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ body: secondBody, seoImagePath: seoImagePathB, expectedVersion: galleryVersionCountAtStart + 1 });
      expect(secondRes.status).toBe(200);
      const snapshotVersion = galleryVersionCountAtStart + 2;
      expect(secondRes.body.data.currentVersion).toBe(snapshotVersion);

      const versionRes = await request(httpServer)
        .get(`/api/v1/crm/content-pages/${galleryPageId}/versions/${snapshotVersion}`)
        .set("Cookie", cookieHeader(superAdminCookies));
      expect(versionRes.status).toBe(200);
      // The snapshot captures the PRIOR (first-save) seoImagePath/headline, not the
      // just-submitted second-save values.
      expect(versionRes.body.data.seoImagePath).toBe(seoImagePathA);
      expect(versionRes.body.data.body[0].data.headline).toBe(newHeadline);

      const publicResAfterSecond = await request(httpServer).get("/api/v1/public/pages/gallery");
      expect(publicResAfterSecond.body.data.seoImagePath).toBe(seoImagePathB);
      expect(publicResAfterSecond.body.data.body[0].data.headline).toBe(secondHeadline);

      const auditRow = await prisma.auditLog.findFirst({ where: { tenantId, entity: "ContentPageVersion" }, orderBy: { createdAt: "desc" } });
      expect(auditRow).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Colleges CRUD (/crm/colleges) — dedicated screen over Partner(category=college_partner)
  // ═══════════════════════════════════════════════════════════════════════

  describe("/crm/colleges — RBAC", () => {
    it("counsellor (holds NO content.* permission) is 403'd on every verb", async () => {
      const listRes = await request(httpServer).get("/api/v1/crm/colleges").set("Cookie", cookieHeader(counsellorCookies));
      expect(listRes.status).toBe(403);

      const createRes = await request(httpServer)
        .post("/api/v1/crm/colleges")
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor)
        .send({ name: "Should Not Be Created" });
      expect(createRes.status).toBe(403);

      const patchRes = await request(httpServer)
        .patch(`/api/v1/crm/colleges/00000000-0000-0000-0000-000000000000`)
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor)
        .send({ name: "Nope" });
      expect(patchRes.status).toBe(403);

      const deleteRes = await request(httpServer)
        .delete(`/api/v1/crm/colleges/00000000-0000-0000-0000-000000000000`)
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor);
      expect(deleteRes.status).toBe(403);
    });
  });

  describe("/crm/colleges — create -> list (category-filtered) -> update -> soft-delete, each audited", () => {
    let collegeId: string;
    let hiringPartnerId: string;

    it("content_editor (content.view/create/edit/delete — no dedicated colleges.* permission) creates a college; category defaults to college_partner; focus/established/city persist", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/colleges")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ name: `QA Institute of Technology ${suffix}`, focus: "Engineering & CS", established: 1999, city: "Hyderabad", status: "published" });
      expect(res.status).toBe(201);
      expect(res.body.data.category).toBe("college_partner");
      expect(res.body.data.focus).toBe("Engineering & CS");
      expect(res.body.data.established).toBe(1999);
      expect(res.body.data.city).toBe("Hyderabad");
      collegeId = res.body.data.id;
      fixturePartnerIds.push(collegeId);

      const auditRow = await prisma.auditLog.findFirst({ where: { tenantId, entity: "Partner", entityId: collegeId, action: "create" } });
      expect(auditRow).not.toBeNull();
    });

    it("a generic hiring/tech partner row (category != college_partner) is created directly, to prove the Colleges list filters it OUT", async () => {
      const hiring = await prisma.partner.create({
        data: { tenantId, name: `QA Hiring Partner ${suffix}`, category: "hiring_partner", status: "published", order: 0 },
      });
      hiringPartnerId = hiring.id;
      fixturePartnerIds.push(hiringPartnerId);
    });

    it("GET /crm/colleges lists the college but NOT the hiring/tech partner row", async () => {
      const res = await request(httpServer)
        .get("/api/v1/crm/colleges")
        .set("Cookie", cookieHeader(superAdminCookies))
        .query({ search: suffix, pageSize: 50 });
      expect(res.status).toBe(200);
      const ids = res.body.data.map((c: { id: string }) => c.id);
      expect(ids).toContain(collegeId);
      expect(ids).not.toContain(hiringPartnerId);
    });

    it("PATCH /crm/colleges/:id persists a partial update to focus/established/city, audited", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/colleges/${collegeId}`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ focus: "Data Science", established: 2005, city: "Bengaluru" });
      expect(res.status).toBe(200);
      expect(res.body.data.focus).toBe("Data Science");
      expect(res.body.data.established).toBe(2005);
      expect(res.body.data.city).toBe("Bengaluru");

      const auditRow = await prisma.auditLog.findFirst({ where: { tenantId, entity: "Partner", entityId: collegeId, action: "update" }, orderBy: { createdAt: "desc" } });
      expect(auditRow).not.toBeNull();
    });

    it("DELETE /crm/colleges/:id soft-deletes (row survives with deletedAt set) and it disappears from the list, audited", async () => {
      const res = await request(httpServer)
        .delete(`/api/v1/crm/colleges/${collegeId}`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ deleted: true });

      const row = await prisma.partner.findUnique({ where: { id: collegeId } });
      expect(row).not.toBeNull(); // soft-delete, never hard-deleted
      expect(row.deletedAt).not.toBeNull();

      const listRes = await request(httpServer)
        .get("/api/v1/crm/colleges")
        .set("Cookie", cookieHeader(superAdminCookies))
        .query({ search: suffix, pageSize: 50 });
      expect(listRes.body.data.map((c: { id: string }) => c.id)).not.toContain(collegeId);

      const auditRow = await prisma.auditLog.findFirst({ where: { tenantId, entity: "Partner", entityId: collegeId, action: "delete" } });
      expect(auditRow).not.toBeNull();
    });
  });

  describe("/crm/colleges — tenant-scope isolation", () => {
    it("a Partner(category=college_partner) row seeded under a DIFFERENT tenant is invisible to tenant-A's list/update/delete", async () => {
      const listRes = await request(httpServer).get("/api/v1/crm/colleges").set("Cookie", cookieHeader(superAdminCookies)).query({ pageSize: 200 });
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.map((c: { id: string }) => c.id)).not.toContain(foreignTenantPartnerId);

      const patchRes = await request(httpServer)
        .patch(`/api/v1/crm/colleges/${foreignTenantPartnerId}`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ name: "Hijacked cross-tenant" });
      expect(patchRes.status).toBe(404);

      const deleteRes = await request(httpServer)
        .delete(`/api/v1/crm/colleges/${foreignTenantPartnerId}`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin);
      expect(deleteRes.status).toBe(404);

      // Confirm it was never mutated by the rejected cross-tenant attempts above.
      const row = await prisma.partner.findUnique({ where: { id: foreignTenantPartnerId } });
      expect(row.name).toBe("Foreign Tenant College");
      expect(row.deletedAt).toBeNull();
    });
  });
});
