// apps/api/test/integration/org-teams.integration-spec.ts
//
// The org hierarchy — teams, managers, team leads, HR — over HTTP against a real Postgres +
// Redis (docs/specs/org-teams.md, ADR-0069). Same shape as leave-management.integration-spec.ts.
//
// COVERAGE — the properties no unit test can reach, because each depends on the real RBAC
// seed, the real guards, or a real transaction:
//
//   - THE NARROWING (the headline): `org.teams.manage` is seeded OUTSIDE the catalog in
//     prisma/seed.ts, so `admin` may READ the chart and may not rewrite it. That is a
//     placement in a seed file, not a line of application code, and only a real login
//     against a real seed can tell whether it held.
//   - THE UNIFORM GRANT, the other half of the same design: every staff role really does
//     hold `leave.approve`. Asserted here against a live database because it was missing
//     from prisma/seed.ts for the whole of P17's development and nothing failed — a fresh
//     seed produced a company where appointing a team lead did nothing at all.
//   - The assignment rules are enforced SERVER-side, not just in the CRM form.
//   - Disbanding a team DETACHES its members rather than deleting or stranding them.
//   - /me/position needs no permission and takes no user id, so there is no IDOR surface.
//   - The approval chain that comes back is the one the org chart implies, for a member, a
//     lead, a manager and somebody not on the chart at all.

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

describeIfAvailable("Org hierarchy — teams, narrowing and approval chains (real Postgres + Redis)", () => {
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

  interface Actor {
    id: string;
    email: string;
    cookies: string[];
    csrf: string;
  }

  let owner: Actor; // super_admin
  let admin: Actor; // admin — the role the narrowing is aimed at
  let hr: Actor; // hr — company-wide people authority
  let manager: Actor;
  let lead: Actor;
  let member: Actor;
  let outsider: Actor; // staff on no team at all

  const fixtureUserIds: string[] = [];
  const fixtureTeamIds: string[] = [];

  async function login(email: string): Promise<{ cookies: string[]; csrf: string }> {
    const res = await request(httpServer).post("/api/v1/auth/login").send({ email, password: PASSWORD });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const cookies = res.headers["set-cookie"] as string[];
    return { cookies, csrf: extractCsrfToken(cookies) ?? "" };
  }

  /** Creates a live staff account with one role and signs it in. */
  async function createActor(label: string, roleKey: string): Promise<Actor> {
    const role = await prisma.role.findFirst({ where: { tenantId, key: roleKey, deletedAt: null } });
    if (!role) throw new Error(`Role "${roleKey}" not seeded — run \`pnpm db:seed\` first.`);

    const email = `org.${label}.${suffix}@test.com`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        name: `Org ${label}`,
        passwordHash: await argon2.hash(PASSWORD),
        status: "active",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, branchId: null } });
    fixtureUserIds.push(user.id);

    const { cookies, csrf } = await login(email);
    return { id: user.id, email, cookies, csrf };
  }

  /** POST a team as the owner, tracking it for teardown. */
  async function createTeam(body: Record<string, unknown>, as: Actor = owner) {
    const res = await request(httpServer)
      .post("/api/v1/crm/org/teams")
      .set("Cookie", cookieHeader(as.cookies))
      .set("X-CSRF-Token", as.csrf)
      .send(body);
    if (res.status === 201) fixtureTeamIds.push(res.body.data.id);
    return res;
  }

  async function positionOf(actor: Actor) {
    const res = await request(httpServer)
      .get("/api/v1/crm/org/me/position")
      .set("Cookie", cookieHeader(actor.cookies));
    return res;
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
    admin = await createActor("admin", "admin");
    hr = await createActor("hr", "hr");
    manager = await createActor("manager", "counsellor");
    lead = await createActor("lead", "counsellor");
    member = await createActor("member", "counsellor");
    outsider = await createActor("outsider", "support");
  }, 120_000);

  afterEach(async () => {
    // Team names are unique per tenant, and most tests create one — so the chart is torn back
    // down between tests rather than accumulating names that collide on the next run.
    await prisma.user.updateMany({ where: { tenantId, id: { in: fixtureUserIds } }, data: { teamId: null } });
    await prisma.team.deleteMany({ where: { tenantId, id: { in: fixtureTeamIds } } });
    fixtureTeamIds.length = 0;
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { tenantId, id: { in: fixtureUserIds } }, data: { teamId: null } });
    await prisma.team.deleteMany({ where: { tenantId, id: { in: fixtureTeamIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } });

    // SOFT-deleted, not hard-deleted, and that is the schema working rather than a
    // shortcut. These accounts CREATED TEAMS through the API, so `audit_logs` rows name
    // them as the actor; the `audit_logs_guard` trigger (migration audit_logs_immutability)
    // rejects the nulling-out that a real DELETE cascades, with a 42501. Hard-deleting a
    // person who has acted is exactly what an append-only audit trail exists to prevent —
    // the sanctioned escape hatch (`purgeAuditLogs`) is gated to a disposable `_test`
    // database and is not what this suite should reach for. The emails carry a run-unique
    // suffix, so the leftovers never collide with a later run.
    await prisma.user.updateMany({
      where: { id: { in: fixtureUserIds } },
      data: { deletedAt: new Date(), status: "deactivated" },
    });
    await prisma.$disconnect();
    await app.close();
  }, 60_000);

  // ── The narrowing ────────────────────────────────────────────────────────
  //
  // `org.teams.view` is in the seed catalog and `org.teams.manage` is not. That single
  // placement decision is the whole of "admin cannot rewrite reporting lines", and because
  // the approval rule is uniform, rewriting reporting lines IS granting approval authority.

  describe("who may rewrite the org chart", () => {
    it("lets the owner create a team", async () => {
      const res = await createTeam({ name: `Owner Team ${suffix}` });
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(`Owner Team ${suffix}`);
    });

    it("lets HR create a team — maintaining the chart is the HR job description", async () => {
      const res = await createTeam({ name: `HR Team ${suffix}` }, hr);
      expect(res.status).toBe(201);
    });

    it("lets an ADMIN read the chart", async () => {
      await createTeam({ name: `Readable Team ${suffix}` });
      const res = await request(httpServer)
        .get("/api/v1/crm/org/teams")
        .set("Cookie", cookieHeader(admin.cookies));
      expect(res.status).toBe(200);
    });

    it("403s an ADMIN creating a team", async () => {
      const res = await createTeam({ name: `Admin Team ${suffix}` }, admin);
      expect(res.status).toBe(403);
    });

    it("403s an ADMIN editing a team", async () => {
      const created = await createTeam({ name: `Editable Team ${suffix}` });
      const res = await request(httpServer)
        .patch(`/api/v1/crm/org/teams/${created.body.data.id}`)
        .set("Cookie", cookieHeader(admin.cookies))
        .set("X-CSRF-Token", admin.csrf)
        .send({ leadUserId: admin.id });
      expect(res.status).toBe(403);
    });

    // The one that matters most: setting yourself as a team's lead is exactly as powerful as
    // being granted `leave.approve` over its members, so this route carries the same guard.
    it("403s an ADMIN making themselves a team's lead through the members route", async () => {
      const created = await createTeam({ name: `Roster Team ${suffix}` });
      const res = await request(httpServer)
        .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
        .set("Cookie", cookieHeader(admin.cookies))
        .set("X-CSRF-Token", admin.csrf)
        .send({ userIds: [member.id] });
      expect(res.status).toBe(403);
    });

    it("403s an ADMIN disbanding a team", async () => {
      const created = await createTeam({ name: `Doomed Team ${suffix}` });
      const res = await request(httpServer)
        .delete(`/api/v1/crm/org/teams/${created.body.data.id}`)
        .set("Cookie", cookieHeader(admin.cookies))
        .set("X-CSRF-Token", admin.csrf);
      expect(res.status).toBe(403);
    });

    it("403s ordinary staff even READING the chart", async () => {
      // `org.teams.view` reaches admin/super_admin through the catalog, plus hr and
      // branch_manager explicitly. A counsellor is not among them, and does not need to be:
      // /me/position tells them who their own lead is without the whole company's chart.
      const res = await request(httpServer)
        .get("/api/v1/crm/org/teams")
        .set("Cookie", cookieHeader(member.cookies));
      expect(res.status).toBe(403);
    });
  });

  // ── The uniform grant ────────────────────────────────────────────────────

  describe("the uniform leave.approve grant", () => {
    // The seed-level counterpart of org.permission-catalog.spec.ts's source assertions. It
    // is here because the failure it catches is invisible: without this grant a team lead
    // 403s at the guard before the org chart is ever consulted, so leave keeps routing to
    // the owner and looks exactly like a working two-step rollout on day one.
    it("gives every staff role leave.approve at scope=own in the real seed", async () => {
      const staffRoleKeys = [
        "branch_manager",
        "counsellor",
        "faculty",
        "finance",
        "marketing",
        "support",
        "content_editor",
      ];

      const grants = await prisma.rolePermission.findMany({
        where: {
          deletedAt: null,
          permission: { key: "leave.approve" },
          role: { tenantId, key: { in: staffRoleKeys }, deletedAt: null },
        },
        select: { scope: true, role: { select: { key: true } } },
      });

      expect(grants.map((g: { role: { key: string } }) => g.role.key).sort()).toEqual(
        [...staffRoleKeys].sort(),
      );
      for (const grant of grants) expect(grant.scope).toBe("own");
    });

    it("still withholds it from admin, which is the invariant the narrowing rests on", async () => {
      const adminGrant = await prisma.rolePermission.findFirst({
        where: {
          deletedAt: null,
          permission: { key: "leave.approve" },
          role: { tenantId, key: "admin", deletedAt: null },
        },
      });
      expect(adminGrant).toBeNull();
    });
  });

  // ── The assignment rules ─────────────────────────────────────────────────
  //
  // All three exist to keep the approval chain a FUNCTION. The CRM form runs the same
  // `validateTeamAssignment`, but the form is a convenience and this is the refuser.

  describe("assignment rules, enforced server-side", () => {
    it("422s a team whose manager is also its lead", async () => {
      const res = await createTeam({
        name: `Same Person ${suffix}`,
        managerUserId: manager.id,
        leadUserId: manager.id,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("org.invalid_team_assignment");
      expect(res.body.error.detail).toContain("must be different people");
    });

    it("422s adding the lead to their own team's roster", async () => {
      const created = await createTeam({
        name: `Lead Roster ${suffix}`,
        managerUserId: manager.id,
        leadUserId: lead.id,
      });
      const res = await request(httpServer)
        .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf)
        .send({ userIds: [member.id, lead.id] });

      expect(res.status).toBe(422);
      expect(res.body.error.detail).toContain("team lead cannot also be listed as a member");
    });

    it("422s adding the manager to their own team's roster", async () => {
      const created = await createTeam({
        name: `Manager Roster ${suffix}`,
        managerUserId: manager.id,
        leadUserId: lead.id,
      });
      const res = await request(httpServer)
        .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf)
        .send({ userIds: [member.id, manager.id] });

      expect(res.status).toBe(422);
      expect(res.body.error.detail).toContain("manager cannot also be a member");
    });

    // Validated against the roster AS IT STANDS, not against the request body — otherwise
    // promoting an existing member to lead would be accepted and only discovered later.
    it("422s promoting a sitting member to lead", async () => {
      const created = await createTeam({ name: `Promotion ${suffix}`, managerUserId: manager.id });
      await request(httpServer)
        .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf)
        .send({ userIds: [member.id] });

      const res = await request(httpServer)
        .patch(`/api/v1/crm/org/teams/${created.body.data.id}`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf)
        .send({ leadUserId: member.id });

      expect(res.status).toBe(422);
      expect(res.body.error.detail).toContain("team lead cannot also be listed as a member");
    });

    it("409s a duplicate team name, so the chart reads unambiguously", async () => {
      await createTeam({ name: `Unique Name ${suffix}` });
      const res = await createTeam({ name: `Unique Name ${suffix}` });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("org.team_name_taken");
    });

    it("422s a roster naming somebody who is not a live user", async () => {
      const created = await createTeam({ name: `Ghost Roster ${suffix}` });
      const res = await request(httpServer)
        .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf)
        .send({ userIds: [member.id, "00000000-0000-4000-8000-000000000000"] });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("org.unknown_member");
      // All-or-nothing: a silently shorter roster is worse than a refusal, because the
      // person who saved it believes the missing member is on the team.
      const after = await prisma.user.findUnique({ where: { id: member.id }, select: { teamId: true } });
      expect(after.teamId).toBeNull();
    });
  });

  // ── Membership ───────────────────────────────────────────────────────────

  describe("membership is exactly one team", () => {
    it("moves somebody between teams rather than adding them to both", async () => {
      const first = await createTeam({ name: `First Team ${suffix}` });
      const second = await createTeam({ name: `Second Team ${suffix}` });

      const put = (teamId: string) =>
        request(httpServer)
          .put(`/api/v1/crm/org/teams/${teamId}/members`)
          .set("Cookie", cookieHeader(owner.cookies))
          .set("X-CSRF-Token", owner.csrf)
          .send({ userIds: [member.id] });

      await put(first.body.data.id);
      await put(second.body.data.id);

      const after = await prisma.user.findUnique({ where: { id: member.id }, select: { teamId: true } });
      expect(after.teamId).toBe(second.body.data.id);

      const firstDetail = await request(httpServer)
        .get(`/api/v1/crm/org/teams/${first.body.data.id}`)
        .set("Cookie", cookieHeader(owner.cookies));
      expect(firstDetail.body.data.members).toEqual([]);
    });

    it("removes somebody dropped from a roster instead of leaving them attached", async () => {
      const created = await createTeam({ name: `Shrinking Team ${suffix}` });
      const put = (userIds: string[]) =>
        request(httpServer)
          .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
          .set("Cookie", cookieHeader(owner.cookies))
          .set("X-CSRF-Token", owner.csrf)
          .send({ userIds });

      await put([member.id, outsider.id]);
      const shrunk = await put([member.id]);

      expect(shrunk.status).toBe(200);
      expect(shrunk.body.data.members.map((m: { id: string }) => m.id)).toEqual([member.id]);
      const after = await prisma.user.findUnique({ where: { id: outsider.id }, select: { teamId: true } });
      expect(after.teamId).toBeNull();
    });

    // A person outlives the team they were on. Leaving `users.team_id` pointing at a
    // soft-deleted row would strand their approval chain at a lead who no longer exists —
    // and it would strand it SILENTLY, since the row still resolves.
    it("detaches members when a team is disbanded, never deleting them", async () => {
      const created = await createTeam({ name: `Disbanded ${suffix}`, managerUserId: manager.id });
      await request(httpServer)
        .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf)
        .send({ userIds: [member.id] });

      const res = await request(httpServer)
        .delete(`/api/v1/crm/org/teams/${created.body.data.id}`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf);
      expect(res.status).toBe(204);

      const stillThere = await prisma.user.findUnique({
        where: { id: member.id },
        select: { teamId: true, deletedAt: true },
      });
      expect(stillThere.deletedAt).toBeNull();
      expect(stillThere.teamId).toBeNull();

      const team = await prisma.team.findUnique({ where: { id: created.body.data.id } });
      expect(team.deletedAt).not.toBeNull();
    });

    it("404s a team that does not exist, rather than leaking that it might", async () => {
      const res = await request(httpServer)
        .get("/api/v1/crm/org/teams/00000000-0000-4000-8000-000000000000")
        .set("Cookie", cookieHeader(owner.cookies));
      expect(res.status).toBe(404);
    });
  });

  // ── /me/position and the approval chain ──────────────────────────────────
  //
  // The endpoint takes no user id, so scope is structural: there is no parameter to tamper
  // with and therefore no IDOR surface, which is why it carries no @RequirePermission.

  describe("where the signed-in person sits", () => {
    async function buildChain() {
      const created = await createTeam({
        name: `Chain Team ${suffix}`,
        managerUserId: manager.id,
        leadUserId: lead.id,
      });
      await request(httpServer)
        .put(`/api/v1/crm/org/teams/${created.body.data.id}/members`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf)
        .send({ userIds: [member.id] });
      return created.body.data.id as string;
    }

    it("is readable by a member of staff holding no org permission at all", async () => {
      // The same counsellor who is 403'd on GET /teams above. Being told who your own
      // manager is is not a privilege, and gating it would mean the CRM could not render
      // "your request goes to X" on the apply form.
      const res = await positionOf(member);
      expect(res.status).toBe(200);
    });

    it("names the member's lead and manager once they are on a team", async () => {
      const teamId = await buildChain();

      const res = await positionOf(member);
      expect(res.status).toBe(200);
      expect(res.body.data.teamId).toBe(teamId);
      expect(res.body.data.leadUserId).toBe(lead.id);
      expect(res.body.data.managerUserId).toBe(manager.id);
      expect(res.body.data.isHr).toBe(false);
      expect(res.body.data.isOwner).toBe(false);
    });

    it("reports a lead as leading their team, and a manager as managing it", async () => {
      const teamId = await buildChain();

      const leadPosition = await positionOf(lead);
      expect(leadPosition.body.data.leadsTeamIds).toContain(teamId);
      expect(leadPosition.body.data.managesTeamIds).toEqual([]);

      const managerPosition = await positionOf(manager);
      expect(managerPosition.body.data.managesTeamIds).toContain(teamId);
      expect(managerPosition.body.data.leadsTeamIds).toEqual([]);
    });

    it("marks HR and the owner as holding company-wide authority", async () => {
      const hrPosition = await positionOf(hr);
      expect(hrPosition.body.data.isHr).toBe(true);

      const ownerPosition = await positionOf(owner);
      expect(ownerPosition.body.data.isOwner).toBe(true);
    });

    // Day one, nobody is on a team. The chain has to fall back to the owner rather than
    // refuse — locking working people out of a working feature over a gap in admin data is
    // the failure this fallback exists to prevent.
    it("leaves somebody who is on no team with an empty position, not an error", async () => {
      const res = await positionOf(outsider);
      expect(res.status).toBe(200);
      expect(res.body.data.teamId).toBeNull();
      expect(res.body.data.leadUserId).toBeNull();
      expect(res.body.data.managerUserId).toBeNull();
    });

    it("clears the member's chain again once the team is disbanded", async () => {
      const teamId = await buildChain();
      await request(httpServer)
        .delete(`/api/v1/crm/org/teams/${teamId}`)
        .set("Cookie", cookieHeader(owner.cookies))
        .set("X-CSRF-Token", owner.csrf);

      const res = await positionOf(member);
      expect(res.body.data.teamId).toBeNull();
      expect(res.body.data.leadUserId).toBeNull();
    });
  });
});
