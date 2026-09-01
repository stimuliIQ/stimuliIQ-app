// apps/api/src/modules/org/org.service.spec.ts
//
// Unit tests for the org hierarchy's service rules. The repository is a stub — what is under
// test is the decision-making, not Prisma.
//
// The cases that matter are the ones that keep the leave-approval chain a FUNCTION: a team
// whose manager is also its lead, or whose lead is also a member, produces an approval chain
// nobody can predict from the org chart in front of them. Plus the two postures this
// codebase applies everywhere and which are easy to lose in a new module: an out-of-tenant
// id is a 404 and never a 403, and a scope this module cannot resolve fails closed.

import { ForbiddenException, NotFoundException, ConflictException, UnprocessableEntityException } from "@nestjs/common";

import { OrgService } from "./org.service";
import type { OrgRepository } from "./org.repository";
import { scopeContextStorage } from "../auth/lib/scope-context";

const TENANT = "tenant-1";
const ACTOR = "actor-1";
const TEAM = "team-1";
const LEAD = "lead-1";
const MANAGER = "manager-1";
const MEMBER = "member-1";

function teamRow(over: Record<string, unknown> = {}) {
  return {
    id: TEAM,
    name: "Sales",
    branchId: null,
    active: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    manager: { id: MANAGER, name: "Ravi", email: "ravi@x.test" },
    lead: { id: LEAD, name: "Priya", email: "priya@x.test" },
    branch: null,
    _count: { members: 1 },
    ...over,
  };
}

function makeRepo(over: Partial<Record<keyof OrgRepository, unknown>> = {}) {
  return {
    listTeams: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findTeamById: jest.fn().mockResolvedValue(teamRow()),
    findTeamByName: jest.fn().mockResolvedValue(null),
    listMembers: jest.fn().mockResolvedValue([]),
    createTeam: jest.fn().mockResolvedValue(teamRow()),
    updateTeam: jest.fn().mockResolvedValue(teamRow()),
    softDeleteTeam: jest.fn().mockResolvedValue(1),
    setMembers: jest.fn().mockResolvedValue(undefined),
    clearMembers: jest.fn().mockResolvedValue(undefined),
    listAssignableStaff: jest.fn().mockResolvedValue([]),
    findUsersByIds: jest.fn().mockResolvedValue([]),
    findPosition: jest.fn(),
    listSubordinateUserIds: jest.fn().mockResolvedValue([]),
    listUsersWithRole: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as jest.Mocked<OrgRepository>;
}

/** Runs `fn` with a scope context published, the way ScopeInterceptor does per request. */
function withScope<T>(scope: "all" | "branch" | "own" | "assigned", fn: () => Promise<T>): Promise<T> {
  return scopeContextStorage.run(
    { permissionKey: "org.teams.manage", scope, actorId: ACTOR, tenantId: TENANT },
    fn,
  );
}

describe("OrgService", () => {
  describe("scope", () => {
    it("refuses a scope it cannot resolve rather than widening", () => {
      // The org chart is tenant-wide configuration. A branch-scoped caller editing it would
      // be rewriting every branch's reporting lines, so this fails closed.
      const service = new OrgService(makeRepo());

      return expect(
        withScope("branch", () => service.create(TENANT, { name: "Sales", active: true })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("create", () => {
    it("refuses a duplicate team name with a 409", async () => {
      const service = new OrgService(makeRepo({ findTeamByName: jest.fn().mockResolvedValue({ id: "other" }) }));

      await expect(
        withScope("all", () => service.create(TENANT, { name: "Sales", active: true })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("refuses one person as both manager and lead", async () => {
      // Otherwise a member's two approval steps are the same signature twice — a one-step
      // approval wearing a disguise.
      const service = new OrgService(makeRepo());

      await expect(
        withScope("all", () =>
          service.create(TENANT, { name: "Sales", managerUserId: LEAD, leadUserId: LEAD, active: true }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("accepts a team created before its lead is named", async () => {
      // A NOT NULL here would force whoever creates the team to invent an answer.
      const repo = makeRepo();
      const service = new OrgService(repo);

      await withScope("all", () => service.create(TENANT, { name: "Sales", active: true }));

      expect(repo.createTeam).toHaveBeenCalledWith(TENANT, expect.objectContaining({
        managerUserId: null,
        leadUserId: null,
      }));
    });
  });

  describe("update", () => {
    it("404s an id from another tenant rather than 403ing", async () => {
      // A 403 confirms the row exists. Same posture as leave, batches and every other module.
      const service = new OrgService(makeRepo({ findTeamById: jest.fn().mockResolvedValue(null) }));

      await expect(
        withScope("all", () => service.update(TENANT, "someone-elses-team", { name: "X" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses promoting a current member to lead of their own team", async () => {
      // Validated against the roster as it actually stands, not against the request body —
      // otherwise this is accepted and only discovered when their leave reaches themselves.
      const service = new OrgService(
        makeRepo({ listMembers: jest.fn().mockResolvedValue([{ id: MEMBER, name: "A", email: "a@x.test" }]) }),
      );

      await expect(
        withScope("all", () => service.update(TENANT, TEAM, { leadUserId: MEMBER })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("only sends the fields that were actually supplied", async () => {
      const repo = makeRepo();
      const service = new OrgService(repo);

      await withScope("all", () => service.update(TENANT, TEAM, { active: false }));

      expect(repo.updateTeam).toHaveBeenCalledWith(TENANT, TEAM, { active: false });
    });
  });

  describe("setMembers", () => {
    it("refuses a roster containing somebody who is not a live user", async () => {
      // Silently dropping an unknown id would leave the roster quietly smaller than what the
      // person saved, with nothing on screen saying so.
      const service = new OrgService(makeRepo({ findUsersByIds: jest.fn().mockResolvedValue([]) }));

      await expect(
        withScope("all", () => service.setMembers(TENANT, TEAM, { userIds: ["ghost"] })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("refuses adding the team's own lead as a member", async () => {
      const service = new OrgService(
        makeRepo({ findUsersByIds: jest.fn().mockResolvedValue([{ id: LEAD, name: "Priya", email: "p@x.test" }]) }),
      );

      await expect(
        withScope("all", () => service.setMembers(TENANT, TEAM, { userIds: [LEAD] })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("de-duplicates the roster before saving", async () => {
      const repo = makeRepo({
        findUsersByIds: jest.fn().mockResolvedValue([{ id: MEMBER, name: "A", email: "a@x.test" }]),
        listMembers: jest.fn().mockResolvedValue([]),
      });
      const service = new OrgService(repo);

      await withScope("all", () => service.setMembers(TENANT, TEAM, { userIds: [MEMBER, MEMBER] }));

      expect(repo.setMembers).toHaveBeenCalledWith(TENANT, TEAM, [MEMBER]);
    });
  });

  describe("remove", () => {
    it("detaches every member before disbanding, so nobody keeps a pointer to a dead team", async () => {
      const repo = makeRepo();
      const service = new OrgService(repo);

      await withScope("all", () => service.remove(TENANT, TEAM));

      expect(repo.clearMembers).toHaveBeenCalledWith(TENANT, TEAM);
      expect(repo.softDeleteTeam).toHaveBeenCalledWith(TENANT, TEAM);
      // Order matters: clearing after the soft delete would leave a window where a member
      // points at a disbanded team, and the approval chain resolves through that pointer.
      expect(repo.clearMembers.mock.invocationCallOrder[0]!).toBeLessThan(
        repo.softDeleteTeam.mock.invocationCallOrder[0]!,
      );
    });
  });

  describe("resolveApprovalChain", () => {
    it("routes a member through their lead then their manager", async () => {
      const service = new OrgService(
        makeRepo({
          findPosition: jest.fn().mockResolvedValue({
            teamId: TEAM, teamName: "Sales",
            leadUserId: LEAD, leadName: "Priya",
            managerUserId: MANAGER, managerName: "Ravi",
            leadsTeamIds: [], managesTeamIds: [], isHr: false,
          }),
        }),
      );

      const chain = await service.resolveApprovalChain(TENANT, MEMBER);

      expect(chain.steps).toEqual(["lead", "manager"]);
      expect(chain.firstApproverId).toBe(LEAD);
      expect(chain.finalApproverId).toBe(MANAGER);
    });

    it("routes a team LEAD to their manager, even though they are not a member of their own team", async () => {
      // Regression: `validateTeamAssignment` forbids a lead being a member of the team they
      // lead — precisely so they never approve themselves — which leaves their
      // `users.team_id` null. The repository therefore treats a team they LEAD as their
      // approval home; without that, a lead's leave fell through to the HR fallback instead
      // of reaching their manager, which is the rule the owner asked for. Caught by running
      // the resolver against real rows, not by a unit test, so this one exists to keep it.
      const service = new OrgService(
        makeRepo({
          findPosition: jest.fn().mockResolvedValue({
            teamId: TEAM, teamName: "Sales",
            leadUserId: LEAD, leadName: "Priya",
            managerUserId: MANAGER, managerName: "Ravi",
            leadsTeamIds: [TEAM], managesTeamIds: [], isHr: false,
          }),
        }),
      );

      const chain = await service.resolveApprovalChain(TENANT, LEAD);

      expect(chain.steps).toEqual(["manager"]);
      expect(chain.finalApproverId).toBe(MANAGER);
      expect(chain.firstApproverId).toBeNull();
    });

    it("routes somebody with no team to the owner, rather than refusing", async () => {
      // Every existing member of staff on the day teams ship. Failing closed here would lock
      // working people out of a working feature over a gap in admin data.
      const service = new OrgService(
        makeRepo({
          findPosition: jest.fn().mockResolvedValue({
            teamId: null, teamName: null, leadUserId: null, leadName: null,
            managerUserId: null, managerName: null,
            leadsTeamIds: [], managesTeamIds: [], isHr: false,
          }),
        }),
      );

      const chain = await service.resolveApprovalChain(TENANT, MEMBER);

      expect(chain.steps).toEqual(["owner"]);
      expect(chain.fallbackToOwner).toBe(true);
    });
  });

  describe("listFallbackApprovers", () => {
    it("always includes super_admin, not only when there is no HR", async () => {
      // "We hired an HR person who then went on leave" is exactly when a request would land
      // in a queue nobody watches.
      const listUsersWithRole = jest.fn(async (_t: string, roleKey: string) =>
        roleKey === "hr"
          ? [{ id: "hr-1", name: "HR", email: "hr@x.test" }]
          : [{ id: "sa-1", name: "Owner", email: "owner@x.test" }],
      );
      const service = new OrgService(makeRepo({ listUsersWithRole }));

      const approvers = await service.listFallbackApprovers(TENANT);

      expect(approvers.map((a) => a.id).sort()).toEqual(["hr-1", "sa-1"]);
    });

    it("de-duplicates somebody who holds both roles", async () => {
      const same = [{ id: "both-1", name: "Both", email: "both@x.test" }];
      const service = new OrgService(makeRepo({ listUsersWithRole: jest.fn().mockResolvedValue(same) }));

      expect(await service.listFallbackApprovers(TENANT)).toHaveLength(1);
    });
  });
});
