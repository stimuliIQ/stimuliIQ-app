// apps/api/test/integration/leave-management.integration-spec.ts
//
// Staff leave management, exercised over HTTP against a real Postgres + Redis
// (docs/specs/leave-management.md). Same shape as phase-9-tickets.integration-spec.ts.
//
// COVERAGE — the properties that cannot be proved by unit tests because they depend on the
// real RBAC seed, the real guards and real database transactions:
//
//   - THE NARROWING (the headline): `admin` gets 403 on approve and on every setup write.
//     That admin cannot touch leave is a product rule implemented by seeding two permission
//     keys outside the catch-all loop in prisma/seed.ts, and this is the only test that can
//     tell whether that seeding actually held. ADR-0070 widened `leave.approve` to every
//     staff role and left admin's exclusion exactly where it was — so an actor who is not
//     the applicant's approver is now refused by the ORG CHART (404) rather than by the
//     guard (403), while admin is still refused by the guard.
//   - Own-scope isolation: staff A cannot read staff B's request (404, not 403) — yet both
//     appear on the shared calendar, without a reason field on either.
//   - The allowance really moves: apply leaves it alone, approving debits it, rejecting and
//     withdrawing leave it untouched.
//   - Concurrency: two simultaneous approvals of one request produce exactly one success.
//   - The duration is computed server-side against the tenant's real holiday list and
//     working week, and a client-supplied duration is ignored.
//   - The approver actually gets a `leave_requested` notification row.

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

describeIfAvailable("Leave management — integration + RBAC narrowing (real Postgres + Redis)", () => {
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

  // 2026-08-17 is a Monday, so 17–21 is Mon–Fri and the 23rd is the following Sunday.
  // Chosen far enough ahead that "leave that has already started" cannot be true.
  const YEAR = 2027;
  const MON = `${YEAR}-08-16`;
  const FRI = `${YEAR}-08-20`;

  let tenantId: string;
  let superAdminCookies: string[], csrfSuperAdmin: string;
  let adminCookies: string[], csrfAdmin: string;
  let staffACookies: string[], csrfStaffA: string;
  let staffBCookies: string[], csrfStaffB: string;

  let superAdminUserId: string;
  let staffAUserId: string;
  let staffBUserId: string;

  let leaveTypeId: string;
  let unpaidTypeId: string;

  const fixtureUserIds: string[] = [];
  const fixtureLeaveTypeIds: string[] = [];
  const fixtureHolidayIds: string[] = [];

  async function login(email: string, password: string): Promise<{ cookies: string[]; csrf: string }> {
    const res = await request(httpServer).post("/api/v1/auth/login").send({ email, password });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const cookies = res.headers["set-cookie"] as string[];
    return { cookies, csrf: extractCsrfToken(cookies) ?? "" };
  }

  /** Applies for leave as `staffA`, straight through the API. Returns the created row. */
  async function applyAsStaffA(
    body: Record<string, unknown>,
    cookies = staffACookies,
    csrf = csrfStaffA,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await request(httpServer)
      .post("/api/v1/crm/leave/requests")
      .set("Cookie", cookieHeader(cookies))
      .set("X-CSRF-Token", csrf)
      .send({ leaveTypeId, startDate: MON, endDate: FRI, reason: "Family wedding", ...body });
    return { status: res.status, body: res.body };
  }

  async function balanceFor(cookies: string[], typeId: string): Promise<Record<string, number | null>> {
    const res = await request(httpServer)
      .get(`/api/v1/crm/leave/balances?year=${YEAR}`)
      .set("Cookie", cookieHeader(cookies));
    const balances = res.body.data.balances as Array<Record<string, never>>;
    return balances.find((b) => (b as Record<string, unknown>).leaveTypeId === typeId) as never;
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
    const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin", deletedAt: null } });
    const counsellorRole = await prisma.role.findFirst({ where: { tenantId, key: "counsellor", deletedAt: null } });
    if (!superAdminRole || !adminRole || !counsellorRole) {
      throw new Error("Roles not seeded — run `pnpm db:seed` first.");
    }

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string, roleId: string): Promise<string> {
      const email = `leave.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({
        data: { tenantId, email, name: `Leave ${label}`, passwordHash: pwHash, status: "active" },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId: null } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    superAdminUserId = await createUser("superadmin", superAdminRole.id);
    await createUser("admin", adminRole.id);
    staffAUserId = await createUser("staffA", counsellorRole.id);
    staffBUserId = await createUser("staffB", counsellorRole.id);

    // A paid type with an allowance, and an unpaid one that has none by design.
    const paidType = await prisma.leaveType.create({
      data: {
        tenantId,
        key: `casual_${suffix}`.replace(/-/g, "_"),
        name: "Integration Casual Leave",
        paid: true,
        allowHalfDay: true,
        active: true,
        sortOrder: 0,
      },
    });
    leaveTypeId = paidType.id;
    fixtureLeaveTypeIds.push(paidType.id);

    const unpaid = await prisma.leaveType.create({
      data: {
        tenantId,
        key: `unpaid_${suffix}`.replace(/-/g, "_"),
        name: "Integration Unpaid Leave",
        paid: false,
        allowHalfDay: true,
        active: true,
        sortOrder: 1,
      },
    });
    unpaidTypeId = unpaid.id;
    fixtureLeaveTypeIds.push(unpaid.id);

    // 10 days for the year, in half-day units.
    await prisma.leaveQuota.create({
      data: { tenantId, leaveTypeId: paidType.id, year: YEAR, halfDays: 20 },
    });

    // A Wednesday inside the Mon–Fri window, so the working-day maths is observable.
    const holiday = await prisma.holiday.create({
      data: { tenantId, date: new Date(`${YEAR}-08-18T00:00:00.000Z`), name: "Integration Holiday" },
    });
    fixtureHolidayIds.push(holiday.id);

    ({ cookies: superAdminCookies, csrf: csrfSuperAdmin } = await login(`leave.superadmin.${suffix}@test.com`, PASSWORD));
    ({ cookies: adminCookies, csrf: csrfAdmin } = await login(`leave.admin.${suffix}@test.com`, PASSWORD));
    ({ cookies: staffACookies, csrf: csrfStaffA } = await login(`leave.staffA.${suffix}@test.com`, PASSWORD));
    ({ cookies: staffBCookies, csrf: csrfStaffB } = await login(`leave.staffB.${suffix}@test.com`, PASSWORD));
  }, 120_000);

  afterEach(async () => {
    // Each test applies for the same dates, and overlapping requests are refused by design —
    // so the requests are cleared between tests rather than accumulating.
    await prisma.leaveRequest.deleteMany({ where: { tenantId, userId: { in: [staffAUserId, staffBUserId] } } });
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { tenantId, userId: { in: fixtureUserIds } } });
    await prisma.leaveQuota.deleteMany({ where: { tenantId, leaveTypeId: { in: fixtureLeaveTypeIds } } });
    await prisma.leaveType.deleteMany({ where: { id: { in: fixtureLeaveTypeIds } } });
    await prisma.holiday.deleteMany({ where: { id: { in: fixtureHolidayIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } });

    // Soft-deleted, not hard-deleted. These accounts act through the API, so `audit_logs`
    // rows name them, and the append-only `audit_logs_guard` trigger (migration
    // audit_logs_immutability) rejects the cascade a real DELETE performs — a 42501 that
    // failed the whole suite in teardown even when every test passed. Hard-deleting somebody
    // who has acted is precisely what an append-only trail exists to prevent. Run-unique
    // emails keep the leftovers from colliding with a later run.
    await prisma.user.updateMany({
      where: { id: { in: fixtureUserIds } },
      data: { deletedAt: new Date(), status: "deactivated" },
    });
    await prisma.$disconnect();
    await app.close();
  }, 60_000);

  // ── The narrowing ───────────────────────────────────────────────────────
  //
  // These are the tests the whole feature hangs on. `leave.approve` and `leave.manage` are
  // seeded OUTSIDE the catch-all in prisma/seed.ts so that `admin` does not inherit them,
  // and nothing but a real login against a real seed can prove that held.
  //
  // AMENDED BY ADR-0070. "Only the super admin decides" was P13's rule and is no longer the
  // whole one: every staff role now holds `leave.approve`, and WHO may act on WHICH request
  // comes from the org chart. What has NOT changed, and is what this block still pins, is
  // `admin`'s exclusion — that is a placement in a seed file, and a later tidy-up moving the
  // key into the catalog "for consistency" would hand every operational admin authority over
  // everyone's leave with nothing failing.
  //
  // The fixtures here deliberately put NOBODY on a team, so every applicant resolves to the
  // single-step owner fallback. That is not an omission: it is the regression test for the
  // chain a teamless member of staff still gets, which on day one is everybody. The two-step
  // chain has its own suite, leave-two-step-approval.integration-spec.ts.

  describe("who decides, with nobody on the org chart", () => {
    it("lets a super admin approve", async () => {
      const created = await applyAsStaffA({});
      expect(created.status).toBe(201);

      const res = await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/approve`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
    });

    it("403s an ADMIN trying to approve", async () => {
      const created = await applyAsStaffA({});

      const res = await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/approve`)
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({});

      expect(res.status).toBe(403);
    });

    // 404, NOT 403 — and the difference is the whole of ADR-0070's authorisation model.
    //
    // Under P13 this was a 403 from the guard: ordinary staff did not hold `leave.approve`
    // at all. They do now, uniformly, because the permission only says you may reach the
    // approvals endpoint; the org chart decides whose requests you may act on. staffB gets
    // past the guard, resolves to no standing over staffA's request, and is answered 404 —
    // the module's IDOR posture, since a 403 would confirm the request exists and its dates
    // and applicant are exactly what must not be confirmed.
    it("404s a colleague with no standing over the request — the permission is not the gate", async () => {
      const created = await applyAsStaffA({});

      const res = await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/approve`)
        .set("Cookie", cookieHeader(staffBCookies))
        .set("X-CSRF-Token", csrfStaffB)
        .send({});

      expect(res.status).toBe(404);

      // And it really did not move. A 404 that had already written would be worse than a 200.
      const row = await prisma.leaveRequest.findUnique({ where: { id: created.body.data.id } });
      expect(row.status).toBe("pending");
    });

    // The counterpart, and the reason the test above is not simply a weakened assertion:
    // staffB holding the key is not a widening of what they can DO.
    it("still lets that colleague reach the endpoint at all, unlike admin", async () => {
      const grant = await prisma.rolePermission.findFirst({
        where: {
          deletedAt: null,
          permission: { key: "leave.approve" },
          role: { tenantId, key: "counsellor", deletedAt: null },
        },
        select: { scope: true },
      });
      expect(grant).not.toBeNull();
      expect(grant.scope).toBe("own");
    });

    it("403s an ADMIN trying to change the yearly allowance", async () => {
      const res = await request(httpServer)
        .put("/api/v1/crm/leave/setup/quotas")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({ year: YEAR, allocations: [{ leaveTypeId, days: 999 }] });

      expect(res.status).toBe(403);
    });

    it("403s an ADMIN trying to add a holiday", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/leave/setup/holidays")
        .set("Cookie", cookieHeader(adminCookies))
        .set("X-CSRF-Token", csrfAdmin)
        .send({ date: `${YEAR}-12-25`, name: "Sneaky Holiday" });

      expect(res.status).toBe(403);
    });

    // The reads are deliberately open — the apply form needs the types and the calendar
    // needs the holidays, so narrowing those would break the feature for everybody.
    it("lets ordinary staff READ the leave types and holidays", async () => {
      const types = await request(httpServer)
        .get("/api/v1/crm/leave/setup/types")
        .set("Cookie", cookieHeader(staffACookies));
      expect(types.status).toBe(200);

      const holidays = await request(httpServer)
        .get(`/api/v1/crm/leave/setup/holidays?year=${YEAR}`)
        .set("Cookie", cookieHeader(staffACookies));
      expect(holidays.status).toBe(200);
    });

    it("403s ordinary staff trying to WRITE a leave type", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/leave/setup/types")
        .set("Cookie", cookieHeader(staffACookies))
        .set("X-CSRF-Token", csrfStaffA)
        .send({ key: "sneaky", name: "Sneaky Leave" });

      expect(res.status).toBe(403);
    });
  });

  // ── Own-scope isolation ─────────────────────────────────────────────────

  describe("own-scope isolation", () => {
    it("shows staff A only their own requests", async () => {
      await applyAsStaffA({});
      await request(httpServer)
        .post("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(staffBCookies))
        .set("X-CSRF-Token", csrfStaffB)
        .send({ leaveTypeId, startDate: MON, endDate: FRI, reason: "Also away" });

      const res = await request(httpServer)
        .get("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(staffACookies));

      expect(res.status).toBe(200);
      const rows = res.body.data as Array<{ userId: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.userId).toBe(staffAUserId);
    });

    // 404 rather than 403: a 403 confirms the row exists, which is itself a disclosure.
    it("404s staff A reading staff B's request", async () => {
      const created = await request(httpServer)
        .post("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(staffBCookies))
        .set("X-CSRF-Token", csrfStaffB)
        .send({ leaveTypeId, startDate: MON, endDate: FRI, reason: "Private matter" });

      const res = await request(httpServer)
        .get(`/api/v1/crm/leave/requests/${created.body.data.id}`)
        .set("Cookie", cookieHeader(staffACookies));

      expect(res.status).toBe(404);
    });

    it("shows the super admin everybody's requests", async () => {
      await applyAsStaffA({});

      const res = await request(httpServer)
        .get("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(superAdminCookies));

      expect(res.status).toBe(200);
      expect((res.body.data as unknown[]).length).toBeGreaterThan(0);
    });

    it("ignores a client-supplied userId at own scope instead of honouring it", async () => {
      await applyAsStaffA({});

      const res = await request(httpServer)
        .get(`/api/v1/crm/leave/requests?userId=${staffBUserId}`)
        .set("Cookie", cookieHeader(staffACookies));

      expect(res.status).toBe(200);
      for (const row of res.body.data as Array<{ userId: string }>) {
        expect(row.userId).toBe(staffAUserId);
      }
    });
  });

  // ── The calendar ────────────────────────────────────────────────────────

  describe("the shared calendar", () => {
    /** staffB books the same week off, and the owner signs it off. Returns nothing. */
    async function bookAndApproveStaffB(reason: string): Promise<void> {
      const created = await request(httpServer)
        .post("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(staffBCookies))
        .set("X-CSRF-Token", csrfStaffB)
        .send({ leaveTypeId, startDate: MON, endDate: FRI, reason });

      await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/approve`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({});
    }

    function calendarAs(cookies: string[]) {
      return request(httpServer)
        .get(`/api/v1/crm/leave/calendar?from=${YEAR}-08-01&to=${YEAR}-08-31`)
        .set("Cookie", cookieHeader(cookies));
    }

    // NARROWED BY ADR-0069. Until the org chart landed this asserted the opposite — every
    // staff role held `leave.calendar.view` at scope=all, so anybody could read the whole
    // company's absences and the "team" filter was a convenience sitting on top of a view
    // that showed everything, which is not the same thing as a boundary.
    //
    // Now scope=own means yourself PLUS the people you approve for, and it is enforced
    // server-side with no request that widens it. staffA leads nobody, so staffA sees
    // strictly staffA. That is a deliberate tightening, and it is worth knowing that it
    // makes the calendar much emptier for rank-and-file staff than it used to be.
    it("does NOT show a colleague's leave to somebody who approves for nobody", async () => {
      await bookAndApproveStaffB("A private medical matter");

      const res = await calendarAs(staffACookies);

      expect(res.status).toBe(200);
      const entry = (res.body.data.entries as Array<Record<string, unknown>>).find(
        (e) => e.userId === staffBUserId,
      );
      expect(entry).toBeUndefined();
    });

    it("shows it to somebody at scope=all, and still never carries the reason", async () => {
      await bookAndApproveStaffB("A private medical matter");

      const res = await calendarAs(superAdminCookies);

      expect(res.status).toBe(200);
      const entry = (res.body.data.entries as Array<Record<string, unknown>>).find(
        (e) => e.userId === staffBUserId,
      );
      expect(entry).toBeDefined();
      expect(entry!.isSelf).toBe(false);
      // The projection never fetches it, so it cannot appear here under any key. This is the
      // half that did NOT change: the team sees WHEN somebody is out, never WHY.
      expect(entry).not.toHaveProperty("reason");
      expect(JSON.stringify(res.body)).not.toContain("A private medical matter");
    });

    it("still shows a person their own leave", async () => {
      await request(httpServer)
        .post("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(staffACookies))
        .set("X-CSRF-Token", csrfStaffA)
        .send({ leaveTypeId, startDate: MON, endDate: FRI, reason: "Family wedding" });

      const res = await calendarAs(staffACookies);
      const own = (res.body.data.entries as Array<Record<string, unknown>>).find(
        (e) => e.userId === staffAUserId,
      );
      expect(own).toBeDefined();
      expect(own!.isSelf).toBe(true);
    });

    it("carries the holidays and the working week", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/crm/leave/calendar?from=${YEAR}-08-01&to=${YEAR}-08-31`)
        .set("Cookie", cookieHeader(staffACookies));

      expect(res.status).toBe(200);
      expect(res.body.data.weeklyOffDays).toBeDefined();
      const dates = (res.body.data.holidays as Array<{ date: string }>).map((h) => h.date);
      expect(dates).toContain(`${YEAR}-08-18`);
    });

    // Postgres DATE columns come back as UTC-midnight Dates; anything other than
    // "YYYY-MM-DD" on the wire renders a day early west of UTC.
    it("emits dates as YYYY-MM-DD, never as timestamps", async () => {
      const res = await request(httpServer)
        .get(`/api/v1/crm/leave/calendar?from=${YEAR}-08-01&to=${YEAR}-08-31`)
        .set("Cookie", cookieHeader(staffACookies));

      for (const holiday of res.body.data.holidays as Array<{ date: string }>) {
        expect(holiday.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  // ── Duration and allowance ──────────────────────────────────────────────

  describe("duration and allowance", () => {
    it("computes the duration server-side, skipping the holiday in the range", async () => {
      const created = await applyAsStaffA({});
      // Mon–Fri is 5 days; the Wednesday holiday takes it to 4.
      expect(created.body.data.days).toBe(4);
      expect(created.body.data.halfDays).toBe(8);
    });

    // The original of this test asserted the server IGNORED a client-supplied duration and
    // read `data.halfDays` off the response. It could never have passed:
    // `CreateLeaveRequestRequestSchema` is `.strict()`, so an unknown key is a 400 and
    // `data` is null. Refusing is the stronger behaviour anyway — silently ignoring a field
    // somebody sent leaves them believing it was honoured — so the assertion is corrected to
    // the real contract rather than the schema loosened to fit the test.
    it("REFUSES a duration the client tries to supply, rather than quietly ignoring it", async () => {
      const created = await applyAsStaffA({ halfDays: 2, days: 1 });
      expect(created.status).toBe(400);
      expect(created.body.data).toBeNull();
    });

    it("computes the duration itself when the client sends only the dates", async () => {
      const created = await applyAsStaffA({});
      expect(created.status).toBe(201);
      expect(created.body.data.halfDays).toBe(8);
    });

    it("handles a half-day request", async () => {
      const created = await applyAsStaffA({ endDate: MON, startDayPart: "first_half" });
      expect(created.body.data.days).toBe(0.5);
    });

    it("leaves the allowance untouched until the request is approved", async () => {
      const before = await balanceFor(staffACookies, leaveTypeId);
      await applyAsStaffA({});
      const after = await balanceFor(staffACookies, leaveTypeId);

      expect(after.usedDays).toBe(before.usedDays);
      // ...but pending IS held against what is left, so nobody double-books.
      expect(after.pendingDays).toBe(4);
      expect(after.remainingDays).toBe((before.remainingDays as number) - 4);
    });

    it("debits the allowance on approval", async () => {
      const created = await applyAsStaffA({});
      await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/approve`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({});

      const after = await balanceFor(staffACookies, leaveTypeId);
      expect(after.usedDays).toBe(4);
      expect(after.pendingDays).toBe(0);
      expect(after.remainingDays).toBe(6);
    });

    it("restores the allowance when a request is turned down", async () => {
      const created = await applyAsStaffA({});
      const res = await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/reject`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ reason: "Too many people out that week" });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewNote).toBe("Too many people out that week");

      const after = await balanceFor(staffACookies, leaveTypeId);
      expect(after.usedDays).toBe(0);
      expect(after.remainingDays).toBe(10);
    });

    it("restores the allowance when the applicant withdraws", async () => {
      const created = await applyAsStaffA({});
      const res = await request(httpServer)
        .post(`/api/v1/crm/leave/requests/${created.body.data.id}/cancel`)
        .set("Cookie", cookieHeader(staffACookies))
        .set("X-CSRF-Token", csrfStaffA)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");

      const after = await balanceFor(staffACookies, leaveTypeId);
      expect(after.remainingDays).toBe(10);
    });

    it("refuses a request bigger than the remaining allowance, counting pending", async () => {
      await applyAsStaffA({});
      // 4 days already pending out of 10; ask for another 9 working days.
      const second = await applyAsStaffA({ startDate: `${YEAR}-09-01`, endDate: `${YEAR}-09-13` });

      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe("leave.quota_exceeded");
    });

    it("never refuses unpaid leave on allowance grounds", async () => {
      const res = await applyAsStaffA({ leaveTypeId: unpaidTypeId, startDate: `${YEAR}-09-01`, endDate: `${YEAR}-09-13` });
      expect(res.status).toBe(201);
    });

    it("refuses a request spanning two calendar years", async () => {
      const res = await applyAsStaffA({ startDate: `${YEAR}-12-30`, endDate: `${YEAR + 1}-01-02` });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("leave.cross_year");
    });

    it("refuses a request overlapping one the applicant already holds", async () => {
      await applyAsStaffA({});
      const second = await applyAsStaffA({ startDate: FRI, endDate: `${YEAR}-08-24` });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("leave.overlapping_request");
    });

    it("refuses a rejection with no reason", async () => {
      const created = await applyAsStaffA({});
      const res = await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/reject`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ reason: "" });

      expect(res.status).toBe(400);
    });
  });

  // ── Concurrency ─────────────────────────────────────────────────────────

  describe("concurrency", () => {
    // The status-guarded UPDATE is what makes this safe; a check-then-write would debit the
    // allowance twice for one absence.
    it("lets exactly one of two simultaneous approvals win", async () => {
      const created = await applyAsStaffA({});
      const id = created.body.data.id;

      const approve = () =>
        request(httpServer)
          .post(`/api/v1/crm/leave/approvals/${id}/approve`)
          .set("Cookie", cookieHeader(superAdminCookies))
          .set("X-CSRF-Token", csrfSuperAdmin)
          .send({});

      const [first, second] = await Promise.all([approve(), approve()]);
      const statuses = [first.status, second.status].sort();

      expect(statuses).toEqual([200, 409]);

      const after = await balanceFor(staffACookies, leaveTypeId);
      expect(after.usedDays).toBe(4); // debited once, not twice
    });

    it("refuses to re-decide an already-decided request", async () => {
      const created = await applyAsStaffA({});
      await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/reject`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({ reason: "No cover available" });

      const res = await request(httpServer)
        .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/approve`)
        .set("Cookie", cookieHeader(superAdminCookies))
        .set("X-CSRF-Token", csrfSuperAdmin)
        .send({});

      expect(res.status).toBe(409);
    });
  });

  // ── Notifications ───────────────────────────────────────────────────────

  it("notifies the super admin that a request is waiting", async () => {
    await applyAsStaffA({});

    const notification = await prisma.notification.findFirst({
      where: { tenantId, userId: superAdminUserId, type: "leave_requested" },
      orderBy: { createdAt: "desc" },
    });

    expect(notification).not.toBeNull();
    // `payload`, not `body`. The Notification model has no `body` column — it carries a
    // typed per-type JSON blob — so the original `notification.body` was undefined and this
    // assertion passed vacuously against `toContain` only because it threw first.
    expect(notification.payload.applicantName).toBe("Leave staffA");
  });

  it("notifies the applicant of the decision", async () => {
    const created = await applyAsStaffA({});
    await request(httpServer)
      .post(`/api/v1/crm/leave/approvals/${created.body.data.id}/approve`)
      .set("Cookie", cookieHeader(superAdminCookies))
      .set("X-CSRF-Token", csrfSuperAdmin)
      .send({});

    const notification = await prisma.notification.findFirst({
      where: { tenantId, userId: staffAUserId, type: "leave_approved" },
      orderBy: { createdAt: "desc" },
    });

    expect(notification).not.toBeNull();
  });
});
