// apps/api/test/integration/phase-9-must-change-password-gate.integration-spec.ts
//
// Gap-closing pass, GAP #1: server-side enforcement of the first-login "must change
// password" gate (MustChangePasswordGuard, registered globally via APP_GUARD). Previously
// this was enforced ONLY client-side (apps/lms FirstLoginGate) — a valid session for a
// `mustChangePassword: true` account could call any other authenticated API route. This
// spec proves the REAL Nest application, over a REAL Postgres + Redis DB, now blocks that
// with 403 `auth.password_change_required` — while GET /me, POST /auth/change-password,
// and POST /auth/logout stay reachable (the minimal `@SkipPasswordGate()` allow-list) —
// and that the gate clears after a successful change-password.

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

describeIfAvailable("Gap-closing pass — server-side must-change-password gate — integration (real Postgres + Redis)", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const argon2 = require("argon2");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const { ARGON2_HASH_OPTIONS } = require("../../src/modules/auth/lib/argon2-params");

  let app: import("@nestjs/common").INestApplication;
  let httpServer: ReturnType<typeof app.getHttpServer>;
  let prisma: InstanceType<typeof PrismaClient>;

  const TEMP_PASSWORD = "Temp-P@ssword-123!";
  const NEW_PASSWORD = "Brand-New-P@ssword-456!";
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `p9mcp.student.${suffix}@test.com`;

  let tenantId: string;
  let userId: string;

  async function login(pw: string): Promise<import("supertest").Response> {
    return request(httpServer).post("/api/v1/auth/login").send({ email, password: pw });
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

    const studentRole = await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } });
    if (!studentRole) throw new Error("Roles not seeded — run `pnpm db:seed` first.");

    // Mirrors LmsAccountProvisioningService.provisionForStudentProfile's end state:
    // a hashed temp password + mustChangePassword raised + status active.
    const passwordHash = await argon2.hash(TEMP_PASSWORD, ARGON2_HASH_OPTIONS);
    const user = await prisma.user.create({
      data: { tenantId, email, name: "P9 MCP Student", passwordHash, status: "active", mustChangePassword: true },
    });
    userId = user.id;
    await prisma.userRole.create({ data: { userId: user.id, roleId: studentRole.id, branchId: null } });
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
      // Gamification rows FK to `users`, and lesson completion now writes them.
      await prisma.pointsLedger.deleteMany({ where: { userId: userId } }).catch(() => {});
      await prisma.userBadge.deleteMany({ where: { userId: userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  let cookies: string[];
  let csrfToken: string;

  it("logs in with the temp password — mustChangePassword: true is reflected in the session", async () => {
    const res = await login(TEMP_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
    cookies = res.headers["set-cookie"] as string[];
    csrfToken = extractCsrfToken(cookies) ?? "";
  });

  it("an ORDINARY protected route (GET /crm/students) is BLOCKED — 403 auth.password_change_required", async () => {
    const res = await request(httpServer).get("/api/v1/crm/students").set("Cookie", cookieHeader(cookies));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("auth.password_change_required");
  });

  it("GET /me is NOT blocked — still 200 (SkipPasswordGate) so the client can discover the gate", async () => {
    const res = await request(httpServer).get("/api/v1/me").set("Cookie", cookieHeader(cookies));
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  // --- Pre-session routes must stay reachable while gated ---------------------------
  //
  // REGRESSION (live defect, 2026-08-19): these three authenticate from the request BODY,
  // never from `req.user` — but AuditContextMiddleware still resolves `req.user` from the
  // access-token cookie the browser is carrying, so the global guard 403'd them. That
  // walled a freshly-provisioned student (every one of whom is `mustChangePassword: true`)
  // out of sign-in AND out of password reset from the browser they had just signed in
  // with, and the LMS forgot-password screen reported "check your inbox" regardless.

  it("POST /auth/password-reset/request is NOT blocked while gated — 200, not 403", async () => {
    const res = await request(httpServer)
      .post("/api/v1/auth/password-reset/request")
      .set("Cookie", cookieHeader(cookies))
      .send({ email });
    expect(res.status).toBe(200);
  });

  it("POST /auth/password-reset/confirm is NOT blocked while gated — reaches the token check (422), not 403", async () => {
    const res = await request(httpServer)
      .post("/api/v1/auth/password-reset/confirm")
      .set("Cookie", cookieHeader(cookies))
      .send({ token: "not-a-real-token-but-well-formed", newPassword: NEW_PASSWORD });
    // 422 TOKEN_INVALID_OR_EXPIRED proves the request got PAST the gate and into the
    // service — the point is only that it is not 403 auth.password_change_required.
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("TOKEN_INVALID_OR_EXPIRED");
  });

  it("POST /auth/login is NOT blocked by a gated cookie already in the browser — 200, not 403", async () => {
    const res = await request(httpServer)
      .post("/api/v1/auth/login")
      .set("Cookie", cookieHeader(cookies))
      .send({ email, password: TEMP_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it("POST /auth/change-password with the WRONG current password still 422s (not blocked by the gate itself)", async () => {
    const res = await request(httpServer)
      .post("/api/v1/auth/change-password")
      .set("Cookie", cookieHeader(cookies))
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: "Definitely-Wr0ng!99", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(422);
  });

  it("POST /auth/change-password with the REAL temp password succeeds (SkipPasswordGate) and clears the gate", async () => {
    const res = await request(httpServer)
      .post("/api/v1/auth/change-password")
      .set("Cookie", cookieHeader(cookies))
      .set("X-CSRF-Token", csrfToken)
      .send({ currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser.mustChangePassword).toBe(false);
  });

  it("after change-password, a FRESH session no longer carries mustChangePassword — the previously-blocked route now succeeds", async () => {
    const relogin = await login(NEW_PASSWORD);
    expect(relogin.status).toBe(200);
    expect(relogin.body.data.user.mustChangePassword).toBe(false);
    const freshCookies = relogin.headers["set-cookie"] as string[];

    const res = await request(httpServer).get("/api/v1/crm/students").set("Cookie", cookieHeader(freshCookies));
    // No longer blocked by the password gate. (May still 403 auth.forbidden if the
    // `student` role lacks `students.view` — the assertion only cares that it is NOT the
    // password-gate error, i.e. the gate itself no longer applies.)
    expect(res.status !== 403 || res.body.error?.code !== "auth.password_change_required").toBe(true);
  });

  it("logout still works even while gated — provision a second gated session and confirm SkipPasswordGate on /auth/logout", async () => {
    const passwordHash = await argon2.hash(TEMP_PASSWORD, ARGON2_HASH_OPTIONS);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true } });

    const res = await login(TEMP_PASSWORD);
    expect(res.status).toBe(200);
    const gatedCookies = res.headers["set-cookie"] as string[];
    const gatedCsrf = extractCsrfToken(gatedCookies) ?? "";

    const logoutRes = await request(httpServer)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookieHeader(gatedCookies))
      .set("X-CSRF-Token", gatedCsrf)
      .send({});
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.loggedOut).toBe(true);
  });
});
