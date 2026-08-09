// apps/api/test/integration/phase-9-content.integration-spec.ts
//
// Phase-9 Completion T22 QA gate: Headless Content API integration + isolation tests
// (docs/plans/phase-9-completion.md T22). Exercises the REAL NestJS application over HTTP
// (supertest + real Nest app) against a real Postgres + Redis DB, matching the pattern of
// phase-9-live-classes.integration-spec.ts / phase-9-tickets.integration-spec.ts.
//
// COVERAGE:
//   - Draft/publish workflow: content.create never directly publishes; content.publish
//     (a SEPARATE permission) is required to move status -> published; public read only
//     ever sees published rows — a draft NEVER leaks via any public/* route.
//   - RBAC: non-content.* role (counsellor) 403s; content_editor (scope=all) succeeds.
//   - Content-intake: newsletter subscribe -> admin list; contact submit -> admin list +
//     status update; career apply -> admin list/get with a SIGNED resume download URL
//     (never a raw storage key).
//   - Slug conflict -> 409 (DB partial-unique backstop), matching kb-articles' precedent.

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

describeIfAvailable("Phase-9 Headless Content — integration + RBAC + draft/publish isolation (real Postgres + Redis)", () => {
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
  let contentEditorCookies: string[], csrfContentEditor: string;
  let counsellorCookies: string[], csrfCounsellor: string;

  const fixtureUserIds: string[] = [];
  const fixtureBlogPostIds: string[] = [];
  const fixtureTestimonialIds: string[] = [];
  const fixtureProgramIds: string[] = [];
  const fixtureNewsletterIds: string[] = [];
  const fixtureContactIds: string[] = [];
  const fixtureCareerIds: string[] = [];

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
    const contentEditorRole = await prisma.role.findFirst({ where: { tenantId, key: "content_editor", deletedAt: null } });
    const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
    if (!adminRole || !contentEditorRole || !counsellorRole) {
      throw new Error("Roles not seeded — run `pnpm db:seed` first.");
    }

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string, roleId: string): Promise<string> {
      const email = `p9cms.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({ data: { tenantId, email, name: `P9 CMS ${label}`, passwordHash: pwHash, status: "active" } });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId: null } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    await createUser("admin", adminRole.id);
    await createUser("contentEditor", contentEditorRole.id);
    await createUser("counsellor", counsellorRole.id);

    ({ cookies: adminCookies, csrf: csrfAdmin } = await login(`p9cms.admin.${suffix}@test.com`, PASSWORD));
    ({ cookies: contentEditorCookies, csrf: csrfContentEditor } = await login(`p9cms.contentEditor.${suffix}@test.com`, PASSWORD));
    ({ cookies: counsellorCookies, csrf: csrfCounsellor } = await login(`p9cms.counsellor.${suffix}@test.com`, PASSWORD));
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.blogPost.deleteMany({ where: { id: { in: fixtureBlogPostIds } } }).catch(() => {});
      await prisma.testimonial.deleteMany({ where: { id: { in: fixtureTestimonialIds } } }).catch(() => {});
      await prisma.program.deleteMany({ where: { id: { in: fixtureProgramIds } } }).catch(() => {});
      await prisma.newsletterSubscription.deleteMany({ where: { id: { in: fixtureNewsletterIds } } }).catch(() => {});
      await prisma.contactSubmission.deleteMany({ where: { id: { in: fixtureContactIds } } }).catch(() => {});
      await prisma.careerApplication.deleteMany({ where: { id: { in: fixtureCareerIds } } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // Draft/publish workflow + RBAC + public read
  // ═══════════════════════════════════════════════════════════════════════

  describe("Blog: draft/publish workflow + RBAC + public read", () => {
    let postId: string;
    let slug: string;

    it("non-content.* role (counsellor) -> 403 on create", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/blog/posts")
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor)
        .send({ title: "Should not be created", slug: `nope-${suffix}`, body: "x" });
      expect(res.status).toBe(403);
    });

    it("content_editor creates a post — status='published' in the body is downgraded to 'draft' (publish gate)", async () => {
      slug = `p9-cms-post-${suffix}`;
      const res = await request(httpServer)
        .post("/api/v1/crm/blog/posts")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ title: "How we scaled", slug, body: "Full article body here.", status: "published" });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("draft"); // publish gate: create() never directly publishes
      postId = res.body.data.id;
      fixtureBlogPostIds.push(postId);

      const auditRow = await prisma.auditLog.findFirst({ where: { tenantId, entity: "BlogPost", entityId: postId, action: "create" } });
      expect(auditRow).not.toBeNull();
    });

    it("a DRAFT post is NEVER visible via the public read surface", async () => {
      const publicDetail = await request(httpServer).get(`/api/v1/public/blog/posts/${slug}`);
      expect(publicDetail.status).toBe(404);

      const publicList = await request(httpServer).get("/api/v1/public/blog/posts");
      expect(publicList.status).toBe(200);
      expect(publicList.body.data.some((p: { slug: string }) => p.slug === slug)).toBe(false);
    });

    it("PATCH with status='published' in the body is IGNORED (publish gate) — only POST :id/publish transitions it", async () => {
      const patchAttempt = await request(httpServer)
        .patch(`/api/v1/crm/blog/posts/${postId}`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ status: "published", excerpt: "Updated excerpt" });
      expect(patchAttempt.status).toBe(200);
      expect(patchAttempt.body.data.status).toBe("draft"); // still draft — PATCH cannot publish
      expect(patchAttempt.body.data.excerpt).toBe("Updated excerpt"); // other fields DID update

      const publishRes = await request(httpServer)
        .post(`/api/v1/crm/blog/posts/${postId}/publish`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor);
      expect(publishRes.status).toBe(200);
      expect(publishRes.body.data.status).toBe("published");
      expect(publishRes.body.data.publishedAt).not.toBeNull();
    });

    it("the now-published post IS visible via the public read surface (no draft/status/tenantId leakage)", async () => {
      const publicDetail = await request(httpServer).get(`/api/v1/public/blog/posts/${slug}`);
      expect(publicDetail.status).toBe(200);
      expect(publicDetail.body.data.body).toBe("Full article body here.");
      expect(publicDetail.body.data).not.toHaveProperty("status");
      expect(publicDetail.body.data).not.toHaveProperty("tenantId");
      expect(publicDetail.body.data).not.toHaveProperty("coverImageKey");

      const publicList = await request(httpServer).get("/api/v1/public/blog/posts");
      expect(publicList.body.data.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    });

    it("re-publishing an already-published post -> 409", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/crm/blog/posts/${postId}/publish`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("content.already_published");
    });

    it("duplicate slug -> 409 (DB partial-unique backstop)", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/blog/posts")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ title: "Dup slug", slug, body: "x" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("content.slug_taken");
    });

    it("non-content.* role (counsellor) cannot delete", async () => {
      const res = await request(httpServer)
        .delete(`/api/v1/crm/blog/posts/${postId}`)
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Testimonials: the CRM "Show on website" toggle, end to end
  // ═══════════════════════════════════════════════════════════════════════
  //
  // This block exists because the exact journey it covers was BROKEN and untested:
  // TestimonialsService.update() silently dropped `status: "published"` from the patch and
  // returned 200, and the SDK had no `publish()` method at all — so the CRM could never
  // publish a testimonial, and the homepage's "What Our Students Say" section could never
  // show real content. Blog had this coverage; testimonials never did.
  //
  // Note the deliberate divergence from blog above: blog's PATCH ignores a publish attempt
  // and returns 200, testimonials' PATCH now REJECTS it (400). Silence is what let the bug
  // hide for so long, so this surface fails loudly instead.

  describe("Testimonials: draft -> publish -> unpublish drives homepage visibility", () => {
    let testimonialId: string;
    let programId: string;
    const studentName = `Integration Student ${suffix}`;

    beforeAll(async () => {
      // A real linked program, so the joined `programTitle` on the public DTO is exercised
      // against the actual SQL join rather than a mock.
      const program = await prisma.program.create({
        data: {
          tenantId,
          slug: `p9-testimonial-program-${suffix}`,
          title: "Neurology Workshop",
          domain: "neurology",
          pricePaise: 699900,
          status: "draft",
        },
      });
      programId = program.id;
      fixtureProgramIds.push(program.id);
    });

    it("content_editor creates a testimonial — it lands as a draft even when the body says published", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/testimonials")
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ programId, studentName, quote: "The case discussions changed how I reason.", rating: 50, status: "published", order: 0 });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("draft"); // publish gate
      testimonialId = res.body.data.id;
      fixtureTestimonialIds.push(testimonialId);
    });

    it("a draft testimonial is NOT visible on the public surface — the homepage section stays empty", async () => {
      const publicList = await request(httpServer).get("/api/v1/public/testimonials");
      expect(publicList.status).toBe(200);
      expect(publicList.body.data.some((t: { studentName: string }) => t.studentName === studentName)).toBe(false);
    });

    it("PATCH status='published' is REJECTED (400) rather than silently ignored — the bug this fixes", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/testimonials/${testimonialId}`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ status: "published" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("content.publish_requires_publish_endpoint");

      // And it really is still a draft — not a 400 masking a partial write.
      const row = await prisma.testimonial.findUnique({ where: { id: testimonialId } });
      expect(row?.status).toBe("draft");
    });

    it("POST :id/publish makes it live, and the public DTO carries the joined program title", async () => {
      const publishRes = await request(httpServer)
        .post(`/api/v1/crm/testimonials/${testimonialId}/publish`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor);
      expect(publishRes.status).toBe(200);
      expect(publishRes.body.data.status).toBe("published");

      const publicList = await request(httpServer).get("/api/v1/public/testimonials");
      const mine = publicList.body.data.find((t: { studentName: string }) => t.studentName === studentName);
      expect(mine).toBeDefined();
      expect(mine.quote).toBe("The case discussions changed how I reason.");
      expect(mine.rating).toBe(50);
      expect(mine.programTitle).toBe("Neurology Workshop"); // joined server-side
      // Internal fields must never reach a marketing page.
      expect(mine).not.toHaveProperty("status");
      expect(mine).not.toHaveProperty("programId");
      expect(mine).not.toHaveProperty("tenantId");
    });

    it("PATCH status='draft' unpublishes it — turning the toggle back off hides it again", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/testimonials/${testimonialId}`)
        .set("Cookie", cookieHeader(contentEditorCookies))
        .set("X-CSRF-Token", csrfContentEditor)
        .send({ status: "draft" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("draft");

      const publicList = await request(httpServer).get("/api/v1/public/testimonials");
      expect(publicList.body.data.some((t: { studentName: string }) => t.studentName === studentName)).toBe(false);
    });

    it("non-content.* role (counsellor) cannot publish", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/crm/testimonials/${testimonialId}/publish`)
        .set("Cookie", cookieHeader(counsellorCookies))
        .set("X-CSRF-Token", csrfCounsellor);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Content-intake: newsletter / contact / careers
  // ═══════════════════════════════════════════════════════════════════════

  describe("Content-intake: newsletter/contact/careers (public writes + CRM admin reads)", () => {
    it("newsletter subscribe (public, captcha-gated) -> visible in the admin list", async () => {
      const email = `p9cms.newsletter.${suffix}@test.com`;
      const res = await request(httpServer)
        .post("/api/v1/public/newsletter/subscribe")
        .send({ email, consent: { marketingOptIn: true, tosVersion: "v1.0" }, captchaToken: "noop-token" });
      expect(res.status).toBe(201);
      expect(res.body.data.subscribed).toBe(true);

      const adminList = await request(httpServer)
        .get("/api/v1/crm/newsletter-subscriptions")
        .set("Cookie", cookieHeader(adminCookies));
      expect(adminList.status).toBe(200);
      const found = adminList.body.data.find((s: { email: string; id: string }) => s.email === email);
      expect(found).toBeTruthy();
      fixtureNewsletterIds.push(found.id);
    });

    it("re-subscribing the SAME email is idempotent (no duplicate row, no 409)", async () => {
      const email = `p9cms.newsletter.${suffix}@test.com`;
      const res = await request(httpServer)
        .post("/api/v1/public/newsletter/subscribe")
        .send({ email, consent: { marketingOptIn: false, tosVersion: "v1.0" }, captchaToken: "noop-token" });
      expect(res.status).toBe(201);

      const rows = await prisma.newsletterSubscription.findMany({ where: { tenantId, email } });
      expect(rows).toHaveLength(1);
    });

    it("contact form submit (public) -> visible in the admin list; admin can update its status", async () => {
      const res = await request(httpServer)
        .post("/api/v1/public/contact")
        .send({
          name: "Jane Prospect",
          email: `p9cms.contact.${suffix}@test.com`,
          message: "I have a question about the Full Stack program.",
          consent: { marketingOptIn: false, tosVersion: "v1.0" },
          captchaToken: "noop-token",
        });
      expect(res.status).toBe(201);
      const id = res.body.data.id;
      fixtureContactIds.push(id);

      const adminList = await request(httpServer).get("/api/v1/crm/contact-submissions").set("Cookie", cookieHeader(adminCookies));
      expect(adminList.status).toBe(200);
      expect(adminList.body.data.some((c: { id: string }) => c.id === id)).toBe(true);

      const updateRes = await request(httpServer)
        .patch(`/api/v1/crm/contact-submissions/${id}`)
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({ status: "resolved" });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.status).toBe("resolved");
    });

    it("career application submit (public) -> admin GET mints a SIGNED resume download URL (never the raw storage key)", async () => {
      const res = await request(httpServer).post("/api/v1/public/careers/apply").send({
        name: "Jane Applicant",
        email: `p9cms.career.${suffix}@test.com`,
        role: "Backend Engineer",
        resumeStorageKey: `careers/${tenantId}/jane/resume.pdf`,
        captchaToken: "noop-token",
      });
      expect(res.status).toBe(201);
      const id = res.body.data.id;
      fixtureCareerIds.push(id);

      const detail = await request(httpServer).get(`/api/v1/crm/career-applications/${id}`).set("Cookie", cookieHeader(adminCookies));
      expect(detail.status).toBe(200);
      expect(detail.body.data.resumeDownloadUrl).toMatch(/^https:\/\//);
      expect(detail.body.data).not.toHaveProperty("resumeStorageKey");
    });

    it("non-content.* role (counsellor) cannot read the admin intake lists", async () => {
      const res = await request(httpServer).get("/api/v1/crm/contact-submissions").set("Cookie", cookieHeader(counsellorCookies));
      expect(res.status).toBe(403);
    });
  });
});
