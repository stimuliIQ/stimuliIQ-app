// apps/api/test/integration/leave-two-step-approval.integration-spec.ts
//
// The two-step leave chain — member -> team lead -> manager — over HTTP against a real
// Postgres + Redis (ADR-0070, amending ADR-0065).
//
// WHY A SEPARATE FILE from leave-management.integration-spec.ts: that suite's fixtures
// deliberately put NOBODY on a team, which is what makes it the regression test for the
// single-step chain every teamless applicant still gets. Building an org chart into it would
// silently re-route every one of its cases through a lead and stop it testing that at all.
//
// COVERAGE — the properties that only a real seed, real guards and a real transaction can
// establish:
//
//   - THE PERMISSION IS UNIFORM; THE ORG CHART DECIDES. Every staff role holds the same
//     `leave.approve` key, and who may act on what comes from the team graph. So the same
//     counsellor account is an authorised approver for one request and a 404 for another.
//   - The manager cannot approve at step ONE. Matching on the final approver alone let a
//     manager skip the team lead, and it was invisible on screen — the row simply came back
//     approved, a one-step approval wearing a two-step label.
//   - Days are deducted ONLY on the final step, while a `lead_approved` request still counts
//     as pending and still blocks an overlap. This is what LEAVE_UNCOMMITTED_STATUSES buys,
//     and getting it wrong stops counting somebody's days for the hours the request sits
//     with the manager — a failure in the direction nobody checks.
//   - A lead may REJECT outright but not APPROVE outright.
//   - Nobody decides their own request, including the owner, whose scope=all left that open.
//   - 404 rather than 403 for an actor with no standing: a 403 confirms the request exists,
//     and its dates and applicant are exactly what must not be confirmed.

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

describeIfAvailable("Leave, two-step approval — lead then manager (real Postgres + Redis)", () => {
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

  // 2028-08-14 is a Monday, so 14–18 is Mon–Fri. Far enough ahead that "leave that has
  // already started" can never be true, and a different year from
  // leave-management.integration-spec.ts so the two suites cannot share a quota row.
  const YEAR = 2028;
  const MON = `${YEAR}-08-14`;
  const FRI = `${YEAR}-08-18`;
  /** Mon–Fri with no holiday seeded in this window, so every request here is 5 days. */
  const DAYS = 5;

  interface Actor {
    id: string;
    email: string;
    cookies: string[];
    csrf: string;
  }

  let tenantId: string;
  let owner: Actor;
  let hr: Actor;
  let manager: Actor;
  let lead: Actor;
  let member: Actor;
  let outsider: Actor; // staff on no team — the P13 single-step path, still live
  let teamId: string;
  let leaveTypeId: string;

  const fixtureUserIds: string[] = [];
  const fixtureTeamIds: string[] = [];
  const fixtureLeaveTypeIds: string[] = [];

  async function login(email: string): Promise<{ cookies: string[]; csrf: string }> {
    const res = await request(httpServer).post("/api/v1/auth/login").send({ email, password: PASSWORD });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const cookies = res.headers["set-cookie"] as string[];
    return { cookies, csrf: extractCsrfToken(cookies) ?? "" };
  }

  async function createActor(label: string, roleKey: string): Promise<Actor> {
    const role = await prisma.role.findFirst({ where: { tenantId, key: roleKey, deletedAt: null } });
    if (!role) throw new Error(`Role "${roleKey}" not seeded — run \`pnpm db:seed\` first.`);

    const email = `twostep.${label}.${suffix}@test.com`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        name: `Twostep ${label}`,
        passwordHash: await argon2.hash(PASSWORD),
        status: "active",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, branchId: null } });
    fixtureUserIds.push(user.id);

    const { cookies, csrf } = await login(email);
    return { id: user.id, email, cookies, csrf };
  }

  /** Applies for leave as `who`, straight through the API. */
  async function apply(who: Actor, body: Record<string, unknown> = {}) {
    return request(httpServer)
      .post("/api/v1/crm/leave/requests")
      .set("Cookie", cookieHeader(who.cookies))
      .set("X-CSRF-Token", who.csrf)
      .send({ leaveTypeId, startDate: MON, endDate: FRI, reason: "Family wedding", ...body });
  }

  function approve(who: Actor, id: string) {
    return request(httpServer)
      .post(`/api/v1/crm/leave/approvals/${id}/approve`)
      .set("Cookie", cookieHeader(who.cookies))
      .set("X-CSRF-Token", who.csrf)
      .send({});
  }

  function reject(who: Actor, id: string, reason: string) {
    return request(httpServer)
      .post(`/api/v1/crm/leave/approvals/${id}/reject`)
      .set("Cookie", cookieHeader(who.cookies))
      .set("X-CSRF-Token", who.csrf)
      .send({ reason });
  }

  async function balanceOf(who: Actor): Promise<Record<string, number>> {
    const res = await request(httpServer)
      .get(`/api/v1/crm/leave/balances?year=${YEAR}`)
      .set("Cookie", cookieHeader(who.cookies));
    const balances = res.body.data.balances as Array<Record<string, unknown>>;
    return balances.find((b) => b.leaveTypeId === leaveTypeId) as never;
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

    owner = await createActor("owner", "super_admin");
    hr = await createActor("hr", "hr");
    manager = await createActor("manager", "counsellor");
    lead = await createActor("lead", "counsellor");
    member = await createActor("member", "counsellor");
    outsider = await createActor("outsider", "support");

    // The org chart, built through the API rather than straight into the table — so a
    // regression in the Teams endpoints shows up here too.
    const team = await request(httpServer)
      .post("/api/v1/crm/org/teams")
      .set("Cookie", cookieHeader(owner.cookies))
      .set("X-CSRF-Token", owner.csrf)
      .send({ name: `Two-step Team ${suffix}`, managerUserId: manager.id, leadUserId: lead.id });
    if (team.status !== 201) {
      throw new Error(`team setup failed: ${team.status} ${JSON.stringify(team.body)}`);
    }
    teamId = team.body.data.id;
    fixtureTeamIds.push(teamId);

    await request(httpServer)
      .put(`/api/v1/crm/org/teams/${teamId}/members`)
      .set("Cookie", cookieHeader(owner.cookies))
      .set("X-CSRF-Token", owner.csrf)
      .send({ userIds: [member.id] });

    const paidType = await prisma.leaveType.create({
      data: {
        tenantId,
        key: `twostep_${suffix}`.replace(/-/g, "_"),
        name: "Two-step Casual Leave",
        paid: true,
        allowHalfDay: true,
        active: true,
        sortOrder: 0,
      },
    });
    leaveTypeId = paidType.id;
    fixtureLeaveTypeIds.push(paidType.id);

    // 10 days for the year, in half-day units.
    await prisma.leaveQuota.create({
      data: { tenantId, leaveTypeId: paidType.id, year: YEAR, halfDays: 20 },
    });
  }, 120_000);

  afterEach(async () => {
    // Every test applies for the same dates and overlapping requests are refused by design.
    await prisma.leaveRequest.deleteMany({ where: { tenantId, userId: { in: fixtureUserIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: fixtureUserIds } } });
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { tenantId, userId: { in: fixtureUserIds } } });
    await prisma.leaveQuota.deleteMany({ where: { tenantId, leaveTypeId: { in: fixtureLeaveTypeIds } } });
    await prisma.leaveType.deleteMany({ where: { id: { in: fixtureLeaveTypeIds } } });
    await prisma.user.updateMany({ where: { tenantId, id: { in: fixtureUserIds } }, data: { teamId: null } });
    await prisma.team.deleteMany({ where: { id: { in: fixtureTeamIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } });

    // Soft-deleted rather than hard-deleted, for the reason org-teams.integration-spec.ts
    // sets out in full: the owner here creates a team through the API, so `audit_logs` names
    // these accounts as the actor and the append-only trigger refuses the cascade a real
    // DELETE would perform. Run-unique emails keep the leftovers from colliding.
    await prisma.user.updateMany({
      where: { id: { in: fixtureUserIds } },
      data: { deletedAt: new Date(), status: "deactivated" },
    });
    await prisma.$disconnect();
    await app.close();
  }, 60_000);

  // ── The chain, end to end ────────────────────────────────────────────────

  describe("member -> lead -> manager", () => {
    it("routes a fresh request to the TEAM LEAD, not to the owner", async () => {
      const created = await apply(member);
      expect(created.status).toBe(201);
      expect(created.body.data.status).toBe("pending");

      const toLead = await prisma.notification.findFirst({
        where: { tenantId, userId: lead.id, type: "leave_requested" },
      });
      expect(toLead).not.toBeNull();

      // The P13 behaviour was "fan out to every active super_admin". If that came back, the
      // owner would be sitting on a queue that is no longer theirs.
      const toOwner = await prisma.notification.findFirst({
        where: { tenantId, userId: owner.id, type: "leave_requested" },
      });
      expect(toOwner).toBeNull();
    });

    it("moves the request to lead_approved when the lead approves, deducting nothing", async () => {
      const created = await apply(member);
      const res = await approve(lead, created.body.data.id);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("lead_approved");
      expect(res.body.data.leadApprovedById).toBe(lead.id);
      expect(res.body.data.reviewedById).toBeNull();

      // Still uncommitted: it counts against what is left, but nothing has been spent.
      const balance = await balanceOf(member);
      expect(balance.usedDays).toBe(0);
      expect(balance.pendingDays).toBe(DAYS);
      expect(balance.remainingDays).toBe(10 - DAYS);
    });

    it("tells the MANAGER it is now waiting on them", async () => {
      // Without this hop the two-step chain would be strictly worse than the one-step one it
      // replaced: the lead approves and the request sits silently until somebody happens to
      // open the queue.
      const created = await apply(member);
      await approve(lead, created.body.data.id);

      const toManager = await prisma.notification.findFirst({
        where: { tenantId, userId: manager.id, type: "leave_requested" },
      });
      expect(toManager).not.toBeNull();
    });

    it("deducts the days only when the MANAGER confirms", async () => {
      const created = await apply(member);
      await approve(lead, created.body.data.id);
      const res = await approve(manager, created.body.data.id);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
      // The trail says who did which step, rather than overwriting step one with step two.
      expect(res.body.data.leadApprovedById).toBe(lead.id);
      expect(res.body.data.reviewedById).toBe(manager.id);

      const balance = await balanceOf(member);
      expect(balance.usedDays).toBe(DAYS);
      expect(balance.pendingDays).toBe(0);
      expect(balance.remainingDays).toBe(10 - DAYS);
    });

    it("still blocks an overlapping application while it sits with the manager", async () => {
      // `lead_approved` is uncommitted, not inactive. If it stopped blocking, somebody could
      // hold two approved absences over the same week.
      const created = await apply(member);
      await approve(lead, created.body.data.id);

      const second = await apply(member, { startDate: FRI, endDate: `${YEAR}-08-22` });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("leave.overlapping_request");
    });
  });

  // ── Who may act, and when ────────────────────────────────────────────────

  describe("the org chart decides, not the permission", () => {
    it("404s the MANAGER approving at step one, so the lead cannot be skipped", async () => {
      // The manager is a real approver for this request — just not yet. Matching on the
      // final approver alone let them approve straight from `pending`, which is a one-step
      // approval wearing a two-step label and is invisible on screen.
      const created = await apply(member);
      const res = await approve(manager, created.body.data.id);

      expect(res.status).toBe(404);
      const row = await prisma.leaveRequest.findUnique({ where: { id: created.body.data.id } });
      expect(row.status).toBe("pending");
    });

    it("404s the LEAD trying to sign their own approval a second time", async () => {
      const created = await apply(member);
      await approve(lead, created.body.data.id);
      const res = await approve(lead, created.body.data.id);

      expect(res.status).toBe(404);
      const row = await prisma.leaveRequest.findUnique({ where: { id: created.body.data.id } });
      expect(row.status).toBe("lead_approved");
    });

    it("404s a staff member with the same role and no standing over the request", async () => {
      // `outsider` holds `leave.approve` exactly like the lead does — the permission is
      // uniform. What separates them is the team graph, and nothing else.
      const created = await apply(member);
      const res = await approve(outsider, created.body.data.id);
      expect(res.status).toBe(404);
    });

    it("403s somebody deciding their OWN request, including the owner", async () => {
      // The one place this module answers 403 rather than 404: the actor unambiguously knows
      // the request exists, because it is theirs. A permission cannot express this — the
      // owner holds leave.approve at scope=all, which used to include their own row.
      const created = await apply(owner);
      const res = await approve(owner, created.body.data.id);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("leave.self_review");
    });

    it("sends the LEAD's own request up to their manager, in one step", async () => {
      // A lead cannot recommend their own leave, so their chain starts at the manager — and
      // with only one step left, the manager acts straight from `pending`.
      const created = await apply(lead);
      expect(created.status).toBe(201);

      const res = await approve(manager, created.body.data.id);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
    });

    it("sends a MANAGER's own request to the owner rather than into their own team", async () => {
      const created = await apply(manager);
      const res = await approve(owner, created.body.data.id);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
    });

    it("lets HR decide for somebody who is on no team at all", async () => {
      // The fallback that keeps the company running while the chart is half-built, which is
      // the normal state of one being built.
      const created = await apply(outsider);
      const res = await approve(hr, created.body.data.id);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
    });

    it("lets the owner approve directly from pending, recording them as both steps", async () => {
      // Deliberately visible rather than silent: the row records this actor as the lead
      // approver AND the final one, so the trail says one person did both rather than
      // implying a step that never happened.
      const created = await apply(member);
      const res = await approve(owner, created.body.data.id);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
      expect(res.body.data.leadApprovedById).toBe(owner.id);
      expect(res.body.data.reviewedById).toBe(owner.id);
    });
  });

  // ── Rejection is asymmetric on purpose ───────────────────────────────────

  describe("a lead may say no outright", () => {
    it("lets the LEAD reject at step one, without a second signature", async () => {
      // A "no" should not wait for the manager — the applicant needs to re-plan. Same call
      // P4 makes on grade/send-back and P14 on its four verbs.
      const created = await apply(member);
      const res = await reject(lead, created.body.data.id, "We have nobody covering that week");

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("rejected");
      expect(res.body.data.reviewNote).toBe("We have nobody covering that week");

      const balance = await balanceOf(member);
      expect(balance.usedDays).toBe(0);
      expect(balance.pendingDays).toBe(0);
      expect(balance.remainingDays).toBe(10);
    });

    it("lets the MANAGER reject one the lead had already approved", async () => {
      const created = await apply(member);
      await approve(lead, created.body.data.id);
      const res = await reject(manager, created.body.data.id, "Clashes with the audit");

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("rejected");
      const balance = await balanceOf(member);
      expect(balance.remainingDays).toBe(10);
    });

    it("404s the manager rejecting at step one, exactly as it 404s them approving", async () => {
      const created = await apply(member);
      const res = await reject(manager, created.body.data.id, "Not convenient");
      expect(res.status).toBe(404);
    });
  });

  // ── What each person can see ─────────────────────────────────────────────

  describe("the queue follows the chart", () => {
    it("shows a lead their team's requests as well as their own", async () => {
      // Every staff role holds `leave.view` at scope=own, which is right for somebody with
      // nobody reporting to them. The widening comes from the org chart, not the grant —
      // otherwise a lead could not see what they are being asked to approve.
      await apply(member);

      const res = await request(httpServer)
        .get("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(lead.cookies));

      expect(res.status).toBe(200);
      const userIds = (res.body.data as Array<{ userId: string }>).map((r) => r.userId);
      expect(userIds).toContain(member.id);
    });

    it("shows a manager the team's requests too", async () => {
      await apply(member);

      const res = await request(httpServer)
        .get("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(manager.cookies));

      expect(res.status).toBe(200);
      expect((res.body.data as Array<{ userId: string }>).map((r) => r.userId)).toContain(member.id);
    });

    it("shows an unrelated colleague nothing but their own", async () => {
      await apply(member);
      await apply(outsider);

      const res = await request(httpServer)
        .get("/api/v1/crm/leave/requests")
        .set("Cookie", cookieHeader(outsider.cookies));

      expect(res.status).toBe(200);
      for (const row of res.body.data as Array<{ userId: string }>) {
        expect(row.userId).toBe(outsider.id);
      }
    });

    it("404s an unrelated colleague reading the request by id", async () => {
      const created = await apply(member);
      const res = await request(httpServer)
        .get(`/api/v1/crm/leave/requests/${created.body.data.id}`)
        .set("Cookie", cookieHeader(outsider.cookies));
      expect(res.status).toBe(404);
    });
  });

  // ── Concurrency at the committing step ───────────────────────────────────

  describe("concurrency", () => {
    // Only the final step deducts, so only the final step needs the advisory lock and the
    // status-guarded UPDATE. A check-then-write would debit the allowance twice for one
    // absence.
    it("lets exactly one of two simultaneous manager confirmations win", async () => {
      const created = await apply(member);
      await approve(lead, created.body.data.id);
      const id = created.body.data.id;

      const [first, second] = await Promise.all([approve(manager, id), approve(manager, id)]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);

      const balance = await balanceOf(member);
      expect(balance.usedDays).toBe(DAYS); // debited once, not twice
    });

    it("lets exactly one of two simultaneous lead approvals win", async () => {
      // Step one commits nothing, so the cost of a double-write is not a double deduction —
      // it is the second write overwriting who performed step one.
      const created = await apply(member);
      const id = created.body.data.id;

      const [first, second] = await Promise.all([approve(lead, id), approve(lead, id)]);
      const statuses = [first.status, second.status].sort();

      // The loser is either 409 (it lost the guarded UPDATE) or 404 (it re-read the row
      // after the winner had already moved it past this actor's step). Both are correct
      // refusals; what must never happen is two successes.
      expect(statuses[0]).toBe(200);
      expect([404, 409]).toContain(statuses[1]);

      const row = await prisma.leaveRequest.findUnique({ where: { id } });
      expect(row.status).toBe("lead_approved");
      expect(row.leadApprovedById).toBe(lead.id);
    });
  });
});
