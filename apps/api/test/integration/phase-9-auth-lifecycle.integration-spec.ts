// apps/api/test/integration/phase-9-auth-lifecycle.integration-spec.ts
//
// Phase-9 Completion T28 QA gate: 2FA (TOTP) enroll -> login-gate -> login-verify ->
// disable lifecycle, and the password-reset request -> confirm flow — integration tests
// against the REAL NestJS application (supertest + real Nest app) over a real
// Postgres + Redis DB (2FA secrets + backup codes are the DURABLE Postgres
// `two_factor_credentials` store, per two-factor.service.ts's file header — this is
// exactly the surface a unit test cannot exercise).
//
// COVERAGE:
//   2FA — enroll mints a secret; verify-enroll with a WRONG code -> 401; a REAL TOTP
//     code (computed from the returned secret via the same RFC-6238 util the server
//     uses) activates 2FA + issues backup codes; POST /auth/login for a 2FA-enrolled
//     account now 401s with auth.2fa_required (no session issued); POST
//     /auth/2fa/login-verify with a valid code completes login; disable requires a
//     valid current code (wrong code -> 401); after disable, plain /auth/login works
//     again.
//   Password reset — request() is ALWAYS 200 (enumeration-resistant) for both a real
//     and a fake email; the real token is captured from the (Noop, spied) mail send
//     call; confirm() with a WRONG token -> 422 TOKEN_INVALID_OR_EXPIRED; confirm()
//     with the right token changes the password (old password no longer logs in, new
//     one does); confirm() is SINGLE-USE — replaying the same token -> 422.

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

describeIfAvailable("Phase-9 Auth lifecycle — 2FA (TOTP) + password-reset — integration (real Postgres + Redis)", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const argon2 = require("argon2");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const { generateTotpCode } = require("../../src/modules/auth/lib/totp");
  const { MAIL_PROVIDER } = require("../../src/modules/notifications/providers/mail/mail-provider.interface");

  let app: import("@nestjs/common").INestApplication;
  let httpServer: ReturnType<typeof app.getHttpServer>;
  let prisma: InstanceType<typeof PrismaClient>;
  let mailSpy: { send: jest.Mock };

  const PASSWORD = "P@ssword123!";
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  let tenantId: string;
  const fixtureUserIds: string[] = [];

  async function login(email: string, password: string): Promise<import("supertest").Response> {
    return request(httpServer).post("/api/v1/auth/login").send({ email, password });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: envFile.databaseUrl });
    await prisma.$connect();

    mailSpy = { send: jest.fn().mockResolvedValue({ providerMessageId: "msg-1" }) };

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mailSpy)
      .compile();
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

    const studentRole = await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } });
    if (!studentRole) throw new Error("Roles not seeded — run `pnpm db:seed` first.");

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string): Promise<string> {
      const email = `p9al.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({ data: { tenantId, email, name: `P9 AL ${label}`, passwordHash: pwHash, status: "active" } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: studentRole.id, branchId: null } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    await createUser("2fa");
    await createUser("reset");
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.twoFactorCredential?.deleteMany?.({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // 2FA (TOTP) lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  describe("2FA: enroll -> login-gate -> login-verify -> disable", () => {
    const email = `p9al.2fa.${suffix}@test.com`;
    let userCookies: string[], csrfUser: string;
    let secret: string;

    it("logs in normally BEFORE 2FA is enrolled", async () => {
      const res = await login(email, PASSWORD);
      expect(res.status).toBe(200);
      const cookies = res.headers["set-cookie"] as string[];
      userCookies = cookies;
      csrfUser = extractCsrfToken(cookies) ?? "";
    });

    it("status: 2FA is not enabled yet", async () => {
      const res = await request(httpServer).get("/api/v1/auth/2fa/status").set("Cookie", cookieHeader(userCookies));
      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(false);
    });

    it("enroll mints a pending secret + otpauth URL", async () => {
      const res = await request(httpServer)
        .post("/api/v1/auth/2fa/enroll")
        .set("Cookie", cookieHeader(userCookies))
        .set("X-CSRF-Token", csrfUser);
      expect(res.status).toBe(200);
      expect(res.body.data.secret).toMatch(/^[A-Z2-7]+$/);
      expect(res.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      secret = res.body.data.secret;
    });

    it("verify-enroll with a WRONG code -> 401 TOTP_CODE_INVALID; 2FA still NOT enabled", async () => {
      const res = await request(httpServer)
        .post("/api/v1/auth/2fa/enroll/verify")
        .set("Cookie", cookieHeader(userCookies))
        .set("X-CSRF-Token", csrfUser)
        .send({ code: "000000" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("TOTP_CODE_INVALID");
    });

    it("verify-enroll with the REAL current code activates 2FA + issues backup codes", async () => {
      const code = generateTotpCode(secret);
      const res = await request(httpServer)
        .post("/api/v1/auth/2fa/enroll/verify")
        .set("Cookie", cookieHeader(userCookies))
        .set("X-CSRF-Token", csrfUser)
        .send({ code });
      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(true);
      expect(Array.isArray(res.body.data.backupCodes)).toBe(true);
      expect(res.body.data.backupCodes.length).toBeGreaterThan(0);

      const status = await request(httpServer).get("/api/v1/auth/2fa/status").set("Cookie", cookieHeader(userCookies));
      expect(status.body.data.enabled).toBe(true);
    });

    it("POST /auth/login now REFUSES to issue a session — 401 auth.2fa_required", async () => {
      const res = await login(email, PASSWORD);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("auth.2fa_required");
      expect(res.headers["set-cookie"]).toBeUndefined(); // no session cookies issued
    });

    it("a WRONG password still yields the SAME generic invalid_credentials (2FA status never leaks pre-password-check)", async () => {
      const res = await login(email, "Definitely-Wr0ng-Password!99"); // wrong, but still schema-valid (won't 400 before reaching the service)
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("auth.invalid_credentials");
    });

    it("POST /auth/2fa/login-verify with a WRONG code -> 401, no session", async () => {
      const res = await request(httpServer)
        .post("/api/v1/auth/2fa/login-verify")
        .send({ email, password: PASSWORD, code: "000000" });
      expect(res.status).toBe(401);
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("POST /auth/2fa/login-verify with the REAL current code completes login", async () => {
      const code = generateTotpCode(secret);
      const res = await request(httpServer)
        .post("/api/v1/auth/2fa/login-verify")
        .send({ email, password: PASSWORD, code });
      expect(res.status).toBe(200);
      expect(res.headers["set-cookie"]).toBeDefined();
      userCookies = res.headers["set-cookie"] as string[];
      csrfUser = extractCsrfToken(userCookies) ?? "";
    });

    it("disable with a WRONG code -> 401, 2FA stays enabled", async () => {
      const res = await request(httpServer)
        .post("/api/v1/auth/2fa/disable")
        .set("Cookie", cookieHeader(userCookies))
        .set("X-CSRF-Token", csrfUser)
        .send({ code: "000000" });
      expect(res.status).toBe(401);

      const status = await request(httpServer).get("/api/v1/auth/2fa/status").set("Cookie", cookieHeader(userCookies));
      expect(status.body.data.enabled).toBe(true);
    });

    it("disable with a REAL code succeeds — 2FA is now off, plain login works again", async () => {
      const code = generateTotpCode(secret);
      const res = await request(httpServer)
        .post("/api/v1/auth/2fa/disable")
        .set("Cookie", cookieHeader(userCookies))
        .set("X-CSRF-Token", csrfUser)
        .send({ code });
      expect(res.status).toBe(200);
      expect(res.body.data.disabled).toBe(true);

      const plainLogin = await login(email, PASSWORD);
      expect(plainLogin.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Password reset
  // ═══════════════════════════════════════════════════════════════════════

  describe("Password reset: request (enumeration-resistant) -> confirm (single-use)", () => {
    const email = `p9al.reset.${suffix}@test.com`;
    let resetToken: string;

    it("request() is 200 for a REAL email — mail is sent with a tokenized reset URL", async () => {
      mailSpy.send.mockClear();
      const res = await request(httpServer).post("/api/v1/auth/password-reset/request").send({ email });
      expect(res.status).toBe(200);
      expect(res.body.data.message).toMatch(/password reset link/i);
      expect(mailSpy.send).toHaveBeenCalledTimes(1);

      const html = mailSpy.send.mock.calls[0][0].html as string;
      const match = html.match(/token=([^"&]+)/);
      expect(match).toBeTruthy();
      resetToken = decodeURIComponent(match![1]!);
    });

    it("request() is ALSO 200 for a FAKE email — SAME generic message, no mail sent (enumeration-resistant)", async () => {
      mailSpy.send.mockClear();
      const res = await request(httpServer)
        .post("/api/v1/auth/password-reset/request")
        .send({ email: `p9al.does-not-exist.${suffix}@test.com` });
      expect(res.status).toBe(200);
      expect(res.body.data.message).toMatch(/password reset link/i);
      expect(mailSpy.send).not.toHaveBeenCalled();
    });

    it("confirm() with a WRONG token -> 422 TOKEN_INVALID_OR_EXPIRED", async () => {
      const res = await request(httpServer)
        .post("/api/v1/auth/password-reset/confirm")
        .send({ token: "totally-fabricated-token", newPassword: "NewP@ssword456!" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("TOKEN_INVALID_OR_EXPIRED");
    });

    it("confirm() with the REAL token changes the password — old password no longer logs in, new one does", async () => {
      const res = await request(httpServer)
        .post("/api/v1/auth/password-reset/confirm")
        .send({ token: resetToken, newPassword: "NewP@ssword456!" });
      expect(res.status).toBe(200);

      const oldLogin = await login(email, PASSWORD);
      expect(oldLogin.status).toBe(401);

      const newLogin = await login(email, "NewP@ssword456!");
      expect(newLogin.status).toBe(200);
    });

    it("confirm() is SINGLE-USE — replaying the SAME (now-consumed) token -> 422", async () => {
      const res = await request(httpServer)
        .post("/api/v1/auth/password-reset/confirm")
        .send({ token: resetToken, newPassword: "AnotherP@ssword789!" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("TOKEN_INVALID_OR_EXPIRED");
    });
  });
});
