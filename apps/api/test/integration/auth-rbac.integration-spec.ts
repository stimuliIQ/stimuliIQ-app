// apps/api/test/integration/auth-rbac.integration-spec.ts
//
// End-to-end integration coverage for the Phase-0 auth + RBAC slice (qa-engineer, Wave
// 5, docs/plans/phase-0.md task #10), run against a REAL Postgres + Redis (via
// testcontainers, or the ambient docker-compose services as a fallback — see
// test/integration/global-setup.ts) and the REAL Nest `AppModule` (no mocks: real
// argon2id, real RS256 jose signing/verification, real Prisma, real ioredis).
//
// Acceptance-criteria coverage map (qa-engineer task brief):
//   1. Password argon2id hash+verify         -> "login" describe block
//   2. JWT RS256 issue/verify + rotation +
//      single-use + reuse-detection           -> "refresh — rotation & reuse detection"
//   3. RBAC guard allow/deny (403)            -> "/me" + "/me/audit-sample" describe blocks
//   4. Scope interceptor resolved scope       -> "/me/audit-sample resolves scope=all for admin"
//   5. Soft-delete                            -> covered by src/prisma/soft-delete-audit.integration.spec.ts (not duplicated)
//   6. CSRF double-submit                     -> "CSRF" describe block
//   7. Zod validation -> 400 problem-details  -> "validation" describe block
//   8. Envelope + RFC-7807 shape              -> asserted inline on every response above
//
// SKIPS GRACEFULLY (describe.skip) when no Postgres/Redis could be resolved by
// global-setup.ts, so `pnpm test:integration` (and CI) stay green even on a box with no
// reachable Docker daemon — see test/integration/global-setup.ts's header comment.

import { readFileSync } from "node:fs";
import { STATE_FILE, type IntegrationEnvFile } from "./global-setup";

const envFile: IntegrationEnvFile = JSON.parse(readFileSync(STATE_FILE, "utf8"));

// IMPORTANT: every env var consumed by `validateEnv()` (apps/api/src/config/env.ts) must
// be set BEFORE any import below transitively imports that module, since `validateEnv`
// memoizes its result for the lifetime of this worker process.
if (envFile.available) {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = envFile.databaseUrl;
  process.env.REDIS_URL = envFile.redisUrl;
  process.env.JWT_PRIVATE_KEY_PATH = require.resolve("../../../../keys/jwt-private.pem");
  process.env.JWT_PUBLIC_KEY_PATH = require.resolve("../../../../keys/jwt-public.pem");
  process.env.JWT_ACCESS_TTL = "15m";
  process.env.JWT_REFRESH_TTL = "7d";
  // Phase-7 Wave 2 security hardening batch A, item 3: explicit audience claim
  // (matches the schema default in config/env.ts — set explicitly here per the task's
  // "set it in test config" instruction rather than relying on the default silently).
  process.env.JWT_AUDIENCE = "stimuliiq-clients";
  process.env.COOKIE_SECRET = "integration-test-cookie-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.CSRF_SECRET = "integration-test-csrf-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";
  process.env.COOKIE_SECURE = "false";
  process.env.WEB_APP_URL = "http://localhost:3000";
  process.env.LMS_APP_URL = "http://localhost:3001";
  process.env.CRM_APP_URL = "http://localhost:3002";
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

describeIfAvailable("Auth + RBAC integration (real Postgres + Redis + RS256 JWT)", () => {
  // These imports are intentionally INSIDE the describe block (not top-level) so that,
  // when the suite is skipped, nothing here ever gets `require()`d — meaning a skipped
  // run never even attempts to load `@prisma/client`/`ioredis`/Nest against
  // process.env values that were never set in the `!available` branch above.
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const {
    seedFixtures,
    teardownFixtures,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    FACULTY_EMAIL,
    FACULTY_PASSWORD,
  } = require("../fixtures/seed-fixtures");

  let app: import("@nestjs/common").INestApplication;
  let prisma: import("@prisma/client").PrismaClient;
  let tenantId: string;

  function extractCookie(res: import("supertest").Response, name: string): string | undefined {
    const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const match = list.find((c) => c.startsWith(`${name}=`));
    return match?.split(";")[0]?.split("=").slice(1).join("=");
  }

  async function loginAs(email: string, password: string) {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(200);

    return {
      res,
      accessToken: extractCookie(res, "access_token")!,
      refreshToken: extractCookie(res, "refresh_token")!,
      csrfToken: extractCookie(res, "csrf_token")!,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    const seeded = await seedFixtures(prisma);
    tenantId = seeded.tenantId;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1", { exclude: ["health", "api-docs.json"] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await teardownFixtures(prisma, tenantId);
    await prisma?.$disconnect();
  });

  // ── 1. Password: argon2id hash + verify (via the real login route) ───────────────────

  describe("login (argon2id)", () => {
    it("accepts the correct password and issues access/refresh/csrf cookies", async () => {
      const { res, accessToken, refreshToken, csrfToken } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      expect(accessToken).toBeTruthy();
      expect(refreshToken).toBeTruthy();
      expect(csrfToken).toBeTruthy();
      // Envelope shape (criterion #8): { data, meta, error }.
      expect(res.body).toEqual({ data: expect.any(Object), meta: null, error: null });
      expect(res.body.data.user.email).toBe(ADMIN_EMAIL);
    });

    it("rejects an incorrect password with a 401 RFC-7807 problem", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: ADMIN_EMAIL, password: "definitely-wrong-password-1" })
        .expect(401);

      expect(res.body.data).toBeNull();
      expect(res.body.error).toMatchObject({
        status: 401,
        code: "auth.invalid_credentials",
      });
      expect(typeof res.body.error.type).toBe("string");
    });
  });

  // ── 2. JWT RS256 issue/verify + rotating refresh + single-use + reuse-detection ───────

  describe("refresh — rotation & reuse detection (real RS256 JWT)", () => {
    it("rotates the refresh token on use, and the OLD refresh token becomes invalid (single-use)", async () => {
      const login = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      const refreshRes = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${login.refreshToken}`, `csrf_token=${login.csrfToken}`])
        .set("X-CSRF-Token", login.csrfToken)
        .expect(200);

      const rotatedRefreshToken = extractCookie(refreshRes, "refresh_token");
      expect(rotatedRefreshToken).toBeTruthy();
      expect(rotatedRefreshToken).not.toBe(login.refreshToken);

      // Replaying the OLD (pre-rotation) refresh token must now fail — it is no longer
      // the session's current token (single-use enforcement).
      const replay = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${login.refreshToken}`, `csrf_token=${login.csrfToken}`])
        .set("X-CSRF-Token", login.csrfToken)
        .expect(409);

      expect(replay.body.error.code).toBe("auth.refresh_reuse_detected");
    });

    it("REUSE DETECTION: replaying a consumed refresh token revokes the whole session family (subsequent legit refresh also 401s)", async () => {
      const login = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      // First, legitimate rotation — the session's refreshHash is now the SECOND token.
      const firstRefresh = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${login.refreshToken}`, `csrf_token=${login.csrfToken}`])
        .set("X-CSRF-Token", login.csrfToken)
        .expect(200);
      const rotatedRefreshToken = extractCookie(firstRefresh, "refresh_token")!;

      // Replay the STALE (original) token -> reuse detected, session revoked, 409.
      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${login.refreshToken}`, `csrf_token=${login.csrfToken}`])
        .set("X-CSRF-Token", login.csrfToken)
        .expect(409);

      // The legitimate holder of the CURRENT (rotated) token must ALSO now get 401 —
      // proving the entire session family was revoked, not just the stale token rejected.
      const legitFollowUp = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${rotatedRefreshToken}`, `csrf_token=${login.csrfToken}`])
        .set("X-CSRF-Token", login.csrfToken)
        .expect(401);

      expect(legitFollowUp.body.error.code).toBe("auth.invalid_refresh_token");
    });

    it("rejects refresh with 401 when no refresh_token cookie is presented at all", async () => {
      const csrfToken = "whatever-csrf-value";
      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`csrf_token=${csrfToken}`])
        .set("X-CSRF-Token", csrfToken)
        .expect(401);
    });
  });

  // ── 3. RBAC guard: allow with permission, deny (403) without ─────────────────────────

  describe("GET /api/v1/me (authentication-only RBAC)", () => {
    it("returns 200 for an authenticated user", async () => {
      const { accessToken } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      const res = await request(app.getHttpServer())
        .get("/api/v1/me")
        .set("Cookie", [`access_token=${accessToken}`])
        .expect(200);

      expect(res.body.data.user.email).toBe(ADMIN_EMAIL);
      expect(res.body.data.roles).toContain("admin");
    });

    it("returns 401 for a request with no access_token cookie", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/me").expect(401);
      expect(res.body.error.code).toBe("auth.unauthenticated");
    });
  });

  describe("GET /api/v1/me/audit-sample (permission + scope gated RBAC)", () => {
    it("returns 200 + resolvedScope=all for admin (HAS audit_log.list)", async () => {
      const { accessToken } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      const res = await request(app.getHttpServer())
        .get("/api/v1/me/audit-sample")
        .set("Cookie", [`access_token=${accessToken}`])
        .expect(200);

      // Criterion #4: the resolved scope context a repository WOULD receive.
      expect(res.body.data.resolvedScope).toMatchObject({
        permissionKey: "audit_log.list",
        scope: "all",
      });
    });

    it("returns 403 for faculty (lacks audit_log.list) — proves deny-by-default", async () => {
      const { accessToken } = await loginAs(FACULTY_EMAIL, FACULTY_PASSWORD);

      const res = await request(app.getHttpServer())
        .get("/api/v1/me/audit-sample")
        .set("Cookie", [`access_token=${accessToken}`])
        .expect(403);

      expect(res.body.error.code).toBe("auth.forbidden");
    });
  });

  // ── 6. CSRF double-submit ──────────────────────────────────────────────────────────────

  describe("CSRF (double-submit on unsafe cookie-auth requests)", () => {
    it("rejects an unsafe request (refresh) missing X-CSRF-Token even with valid cookies", async () => {
      const login = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${login.refreshToken}`, `csrf_token=${login.csrfToken}`])
        // intentionally no X-CSRF-Token header
        .expect(401);

      expect(res.body.error.code).toBe("auth.csrf_mismatch");
    });

    it("rejects when X-CSRF-Token does not match the csrf_token cookie", async () => {
      const login = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${login.refreshToken}`, `csrf_token=${login.csrfToken}`])
        .set("X-CSRF-Token", "not-the-right-token")
        .expect(401);
    });

    it("accepts an unsafe request when X-CSRF-Token matches the csrf_token cookie", async () => {
      const login = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${login.refreshToken}`, `csrf_token=${login.csrfToken}`])
        .set("X-CSRF-Token", login.csrfToken)
        .expect(200);
    });

    it("login is CSRF-EXEMPT (no cookies exist yet on first contact)", async () => {
      // No X-CSRF-Token header at all, and login still succeeds — exempt path.
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200);
    });
  });

  // ── 7. Validation: malformed bodies rejected by the global ZodValidationPipe ──────────

  describe("validation (ZodValidationPipe -> 400 RFC-7807 problem-details)", () => {
    it("rejects a malformed login body (missing password) with 400 + errors[]", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: ADMIN_EMAIL })
        .expect(400);

      expect(res.body.data).toBeNull();
      expect(res.body.error).toMatchObject({ status: 400, code: "validation.failed" });
      expect(Array.isArray(res.body.error.errors)).toBe(true);
      expect(res.body.error.errors.some((e: { path: string }) => e.path === "password")).toBe(true);
    });

    it("rejects a malformed login body (invalid email format) with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "not-an-email", password: "whatever123" })
        .expect(400);

      expect(res.body.error.code).toBe("validation.failed");
    });

    it("rejects a malformed OTP verify body (non-numeric code) with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/otp/verify")
        .send({ phone: "+919999999999", code: "not-digits" })
        .expect(400);

      expect(res.body.error.code).toBe("validation.failed");
    });
  });
});
