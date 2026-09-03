// apps/api/test/integration/phase-9-lms-tools.integration-spec.ts
//
// Phase-9 Completion T26/T29 QA gate: video library ingest, bookmarks, lesson notes,
// global search, and the enrollment-gated resource download-url — integration tests
// against the REAL NestJS application (supertest + real Nest app) over a real
// Postgres + Redis DB. Self-contained: own program/module/lessons/resource/enrollment,
// unique per-run suffix, cleans up only what it created.
//
// COVERAGE:
//   Video library — RBAC (content_editor scope=all upload/edit; other roles 403);
//     ingest mints an upload target + creates a `processing` video; the REAL transcode
//     webhook (NoopVideoProvider HMAC) flips status -> ready + sets duration; caption
//     attach; re-ingest for the same lesson REPLACES in place (no duplicate row).
//   Bookmarks — own-scope create/list/delete; duplicate (same refType+refId) -> 409;
//     IDOR (student B cannot delete student A's bookmark) -> 404.
//   Lesson notes — own-scope create/update/delete under a lesson; IDOR -> 404.
//   Global search — tsvector match on an enrolled lesson; NOT-enrolled student sees
//     nothing (own-enrolled-scope only).
//   Resource download-url — enrollment-gated: enrolled student mints a signed URL
//     (never a raw storage key); a student NOT enrolled in the program -> 404 (IDOR, no
//     existence leak).

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
  process.env.VIDEO_PROVIDER = "noop";
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

function cookieHeader(cookies: string[]): string {
  return cookies.map((c) => c.split(";")[0]!).join("; ");
}

function extractCsrfToken(cookies: string[]): string | undefined {
  const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
  return csrfCookie?.split("=")[1]?.split(";")[0];
}

describeIfAvailable("Phase-9 LMS tools — video library / bookmarks / notes / search / resource download — integration", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const argon2 = require("argon2");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const { NoopVideoProvider } = require("../../src/modules/lms/providers/video/noop-video.provider");

  let app: import("@nestjs/common").INestApplication;
  let httpServer: ReturnType<typeof app.getHttpServer>;
  let prisma: InstanceType<typeof PrismaClient>;

  const PASSWORD = "P@ssword123!";
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  let tenantId: string;
  let contentEditorCookies: string[], csrfContentEditor: string;
  let counsellorCookies: string[], csrfCounsellor: string;
  let studentACookies: string[], csrfStudentA: string;
  let studentBCookies: string[], csrfStudentB: string;

  const fixtureUserIds: string[] = [];
  let programId: string;
  let moduleId: string;
  let lessonId: string;
  let lessonId2: string;
  let resourceId: string;
  let enrollmentAId: string;

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
    // rawBody: true mirrors main.ts (NestFactory.create(AppModule, { rawBody: true }))
    // so VideoWebhookController can read req.rawBody for HMAC signature verification —
    // without it req.rawBody is undefined and the webhook handler 400s before ever
    // reaching the signature check (lms-idor-progress-webhook.integration-spec.ts's
    // same fix, precedent for this exact gotcha).
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser(process.env.COOKIE_SECRET));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = app.getHttpServer();

    const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
    if (!tenant) throw new Error("No tenant found — run `pnpm db:seed` first.");
    tenantId = tenant.id;

    const contentEditorRole = await prisma.role.findFirst({ where: { tenantId, key: "content_editor", deletedAt: null } });
    const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
    const studentRole = await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } });
    if (!contentEditorRole || !counsellorRole || !studentRole) {
      throw new Error("Roles not seeded — run `pnpm db:seed` first.");
    }

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string, roleId: string): Promise<string> {
      const email = `p9lt.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({ data: { tenantId, email, name: `P9 LT ${label}`, passwordHash: pwHash, status: "active" } });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId: null } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    const studentAUserId = await createUser("studentA", studentRole.id);
    const studentBUserId = await createUser("studentB", studentRole.id);
    await createUser("contentEditor", contentEditorRole.id);
    await createUser("counsellor", counsellorRole.id);

    const studentAProfile = await prisma.studentProfile.create({ data: { tenantId, userId: studentAUserId, courseType: "btech" } });
    await prisma.studentProfile.create({ data: { tenantId, userId: studentBUserId, courseType: "btech" } });

    const program = await prisma.program.create({
      data: {
        tenantId,
        slug: `p9-lt-prog-${suffix}`,
        title: `P9 LT Program ${suffix}`,
        domain: "Engineering",
        durationWeeks: 8,
        pricePaise: 40000_00,
        status: "published",
      },
    });
    programId = program.id;

    const mod = await prisma.module.create({ data: { programId, title: "Module 1", order: 1 } });
    moduleId = mod.id;

    const lesson = await prisma.lesson.create({
      data: { moduleId, title: "Introduction to Testing", type: "video", order: 1, isPreview: false },
    });
    lessonId = lesson.id;
    const lesson2 = await prisma.lesson.create({
      data: { moduleId, title: "Advanced Testing Patterns", type: "video", order: 2, isPreview: false },
    });
    lessonId2 = lesson2.id;

    const resource = await prisma.resource.create({
      data: { tenantId, lessonId, title: "Lesson Slides", type: "pdf", storageKey: `p9lt/${suffix}/slides.pdf`, size: 1024 },
    });
    resourceId = resource.id;

    const branch = await prisma.branch.create({
      data: { tenantId, name: `P9 LT Branch ${suffix}`, city: "Hyderabad", status: "active" },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        programId,
        branchId: branch.id,
        name: `P9 LT Batch ${suffix}`,
        capacity: 30,
        status: "active",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-06-30"),
      },
    });

    const enrollmentA = await prisma.enrollment.create({
      data: { tenantId, studentId: studentAProfile.id, batchId: batch.id, programId, status: "active" },
    });
    enrollmentAId = enrollmentA.id;
    void enrollmentAId;

    ({ cookies: contentEditorCookies, csrf: csrfContentEditor } = await login(`p9lt.contentEditor.${suffix}@test.com`, PASSWORD));
    ({ cookies: counsellorCookies, csrf: csrfCounsellor } = await login(`p9lt.counsellor.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentACookies, csrf: csrfStudentA } = await login(`p9lt.studentA.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentBCookies, csrf: csrfStudentB } = await login(`p9lt.studentB.${suffix}@test.com`, PASSWORD));
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.bookmark.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.lessonNote.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.video.deleteMany({ where: { lessonId: { in: [lessonId, lessonId2] } } }).catch(() => {});
      await prisma.resource.deleteMany({ where: { id: resourceId } }).catch(() => {});
      await prisma.enrollment.deleteMany({ where: { programId } }).catch(() => {});
      await prisma.studentProfile.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.lesson.deleteMany({ where: { moduleId } }).catch(() => {});
      await prisma.module.deleteMany({ where: { id: moduleId } }).catch(() => {});
      await prisma.batch.deleteMany({ where: { programId } }).catch(() => {});
      await prisma.branch.deleteMany({ where: { tenantId, name: { startsWith: `P9 LT Branch ${suffix}` } } }).catch(() => {});
      await prisma.program.deleteMany({ where: { id: programId } }).catch(() => {});
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
  // Video library
  // ═══════════════════════════════════════════════════════════════════════

  describe("Video library: RBAC, ingest, real transcode webhook, captions, replace-in-place", () => {
    let videoId: string;
    let providerAssetId: string;

    it("counsellor (no videolib.*) -> 403 ingesting a video", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/videos")
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor)
        .send({ lessonId });
      expect(res.status).toBe(403);
    });

    it("content_editor ingests a video — mints an upload target, creates a 'processing' video row", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/videos")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ lessonId });
      expect(res.status).toBe(201);
      expect(res.body.data.uploadUrl).toMatch(/^https:\/\//);
      expect(res.body.data.video.status).toBe("processing");
      videoId = res.body.data.video.id;

      const row = await prisma.video.findUnique({ where: { id: videoId } });
      providerAssetId = row.providerAssetId;
      expect(providerAssetId).toBeTruthy();
    });

    it("the REAL transcode webhook (HMAC-signed) flips status -> ready + sets duration", async () => {
      const payload = { uid: providerAssetId, readyToStream: true, state: "ready", duration: 340 };
      const rawBody = JSON.stringify(payload);
      const sig = NoopVideoProvider.makeWebhookSignature(rawBody);

      const res = await request(httpServer)
        .post("/api/v1/lms/videos/webhook")
        .set("Content-Type", "application/json")
        .set("webhook-signature", sig)
        .send(rawBody);
      expect(res.status).toBe(200);

      const row = await prisma.video.findUnique({ where: { id: videoId } });
      expect(row.status).toBe("ready");
      expect(row.durationS).toBe(340);
    });

    it("an INVALID webhook signature -> 401, no side effects (fail-closed)", async () => {
      const payload = { uid: providerAssetId, readyToStream: true, state: "ready", duration: 999 };
      const res = await request(httpServer)
        .post("/api/v1/lms/videos/webhook")
        .set("Content-Type", "application/json")
        .set("webhook-signature", "definitely-not-valid")
        .send(JSON.stringify(payload));
      expect(res.status).toBe(401);

      const row = await prisma.video.findUnique({ where: { id: videoId } });
      expect(row.durationS).toBe(340); // unchanged — the forged payload never applied
    });

    it("content_editor attaches captions", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/videos/${videoId}/captions`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ captions: [{ language: "en", url: "https://cdn.example.test/captions/en.vtt", label: "English" }] });
      expect(res.status).toBe(200);
      expect(res.body.data.captions).toHaveLength(1);
    });

    it("re-ingesting for the SAME lesson REPLACES in place (no second row for this lesson)", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/videos")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ lessonId });
      expect(res.status).toBe(201);
      expect(res.body.data.video.id).toBe(videoId); // REPLACED IN PLACE — same row id, not a new one
      expect(res.body.data.video.status).toBe("processing"); // reset to processing on re-ingest
      expect(res.body.data.video.captions).toBeNull(); // captions cleared on re-ingest (new asset)

      const activeForLesson = await prisma.video.findMany({ where: { lessonId, deletedAt: null } });
      expect(activeForLesson).toHaveLength(1); // still only ONE row for this lesson (hard-unique lessonId)
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Bookmarks
  // ═══════════════════════════════════════════════════════════════════════

  describe("Bookmarks: own-scope CRUD, duplicate-conflict, IDOR", () => {
    let bookmarkId: string;

    it("student A bookmarks a lesson", async () => {
      const res = await request(httpServer)
        .post("/api/v1/me/bookmarks")
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ refType: "lesson", refId: lessonId, note: "Review before the exam" });
      expect(res.status).toBe(201);
      bookmarkId = res.body.data.id;
    });

    it("bookmarking the SAME (refType, refId) again -> 409 bookmarks.already_exists", async () => {
      const res = await request(httpServer)
        .post("/api/v1/me/bookmarks")
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ refType: "lesson", refId: lessonId });
      expect(res.status).toBe(409);
    });

    it("student A lists their own bookmark", async () => {
      const res = await request(httpServer).get("/api/v1/me/bookmarks").set("Cookie", cookieHeader(studentACookies));
      expect(res.status).toBe(200);
      expect(res.body.data.some((b: { id: string }) => b.id === bookmarkId)).toBe(true);
    });

    it("student B's list is empty — own-scope isolation", async () => {
      const res = await request(httpServer).get("/api/v1/me/bookmarks").set("Cookie", cookieHeader(studentBCookies));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("student B cannot delete student A's bookmark -> 404 (IDOR)", async () => {
      const res = await request(httpServer)
        .delete(`/api/v1/me/bookmarks/${bookmarkId}`)
        .set("Cookie", cookieHeader(studentBCookies))
        .set("X-CSRF-Token", csrfStudentB);
      expect(res.status).toBe(404);
    });

    it("student A deletes their own bookmark", async () => {
      const res = await request(httpServer)
        .delete(`/api/v1/me/bookmarks/${bookmarkId}`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA);
      expect(res.status).toBe(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Lesson notes
  // ═══════════════════════════════════════════════════════════════════════

  describe("Lesson notes: own-scope CRUD, IDOR", () => {
    let noteId: string;

    it("student A creates a note on the lesson", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/me/lessons/${lessonId}/notes`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ body: "Remember: mock the clock for TOTP tests.", timestampS: 120 });
      expect(res.status).toBe(201);
      noteId = res.body.data.id;
    });

    it("student A updates the note", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/me/lessons/${lessonId}/notes/${noteId}`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ body: "Updated: mock the clock AND freeze Date.now()." });
      expect(res.status).toBe(200);
      expect(res.body.data.body).toBe("Updated: mock the clock AND freeze Date.now().");
    });

    it("student B cannot update/delete student A's note -> 404 (IDOR)", async () => {
      const updateRes = await request(httpServer)
        .patch(`/api/v1/me/lessons/${lessonId}/notes/${noteId}`)
        .set("Cookie", cookieHeader(studentBCookies))
        .set("X-CSRF-Token", csrfStudentB)
        .send({ body: "hijacked" });
      expect(updateRes.status).toBe(404);

      const deleteRes = await request(httpServer)
        .delete(`/api/v1/me/lessons/${lessonId}/notes/${noteId}`)
        .set("Cookie", cookieHeader(studentBCookies))
        .set("X-CSRF-Token", csrfStudentB);
      expect(deleteRes.status).toBe(404);
    });

    it("student A deletes their own note", async () => {
      const res = await request(httpServer)
        .delete(`/api/v1/me/lessons/${lessonId}/notes/${noteId}`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA);
      expect(res.status).toBe(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Global search
  // ═══════════════════════════════════════════════════════════════════════

  describe("Global search: tsvector match, own-enrolled scope only", () => {
    it("student A (enrolled) finds their lesson by title keyword", async () => {
      const res = await request(httpServer)
        .get("/api/v1/me/search")
        .query({ q: "Testing" })
        .set("Cookie", cookieHeader(studentACookies));
      expect(res.status).toBe(200);
      expect(res.body.data.results.some((r: { id: string; type: string }) => r.id === lessonId && r.type === "lesson")).toBe(true);
    });

    it("student B (NOT enrolled) finds NOTHING — never leaks another program's content", async () => {
      const res = await request(httpServer)
        .get("/api/v1/me/search")
        .query({ q: "Testing" })
        .set("Cookie", cookieHeader(studentBCookies));
      expect(res.status).toBe(200);
      expect(res.body.data.results.some((r: { id: string }) => r.id === lessonId)).toBe(false);
    });

    it("a query with no matches returns an empty results array (not an error)", async () => {
      const res = await request(httpServer)
        .get("/api/v1/me/search")
        .query({ q: "zzz-no-such-content-zzz" })
        .set("Cookie", cookieHeader(studentACookies));
      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Resource download-url (enrollment-gated)
  // ═══════════════════════════════════════════════════════════════════════

  describe("Resource download-url: enrollment-gated signed URL, never a raw storage key", () => {
    it("student A (enrolled) mints a signed download URL", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/lessons/${lessonId}/resources/${resourceId}/download-url`)
        .set("Cookie", cookieHeader(studentACookies));
      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toBeTruthy();
      expect(res.body.data.filename).toBe("Lesson Slides");
      // "Never returns a raw storage key" (lessons.controller.ts's own doc comment)
      // means no separate `storageKey` FIELD in the response envelope — NOT that the
      // signed URL's own path is free of the object key, which is normal for any real
      // S3/R2 presigned URL (the object key IS the resource path). Assert the shape
      // contract, not an over-strict string-matching property Noop's fake "signed" URL
      // happens to make more visible than a real provider would.
      expect(res.body.data).not.toHaveProperty("storageKey");
      expect(Object.keys(res.body.data).sort()).toEqual(["downloadUrl", "expiresAt", "filename"]);
    });

    it("student B (NOT enrolled) -> 404 (IDOR, no existence leak)", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/lessons/${lessonId}/resources/${resourceId}/download-url`)
        .set("Cookie", cookieHeader(studentBCookies));
      expect(res.status).toBe(404);
    });

    it("an unknown resourceId for an accessible lesson -> 404", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/lessons/${lessonId}/resources/00000000-0000-0000-0000-000000000000/download-url`)
        .set("Cookie", cookieHeader(studentACookies));
      expect(res.status).toBe(404);
    });
  });
});
