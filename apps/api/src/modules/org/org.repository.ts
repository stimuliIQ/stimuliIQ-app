// apps/api/src/modules/org/org.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3) for the org hierarchy.
//
// Every query is tenant-scoped from `req.user.tenantId` (CLAUDE.md §3: never trust a
// tenantId from the client). Soft-delete and audit are applied transparently by the Prisma
// client extensions — `Team` is registered in both (see prisma.service.ts).

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

/** Enough of a person to render a team row. Deliberately no phone, no status, no roles. */
const PERSON_SELECT = { id: true, name: true, email: true } as const;

const TEAM_SELECT = {
  id: true,
  name: true,
  branchId: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  manager: { select: PERSON_SELECT },
  lead: { select: PERSON_SELECT },
  branch: { select: { name: true } },
  _count: { select: { members: true } },
} as const;

export type TeamRow = Prisma.TeamGetPayload<{ select: typeof TEAM_SELECT }>;
export type PersonRow = { id: string; name: string; email: string };

/**
 * Where one person sits, as far as approving their leave is concerned. Assembled in ONE read
 * rather than three, because it is resolved on every leave request, every approvals-queue
 * page and every `/me`.
 */
export interface OrgPositionRow {
  teamId: string | null;
  teamName: string | null;
  leadUserId: string | null;
  leadName: string | null;
  managerUserId: string | null;
  managerName: string | null;
  leadsTeamIds: string[];
  managesTeamIds: string[];
  isHr: boolean;
  isOwner: boolean;
}

@Injectable()
export class OrgRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Teams ────────────────────────────────────────────────────────────────

  async listTeams(filters: {
    tenantId: string;
    q?: string;
    active?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ rows: TeamRow[]; total: number }> {
    const where: Prisma.TeamWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.active === undefined ? {} : { active: filters.active }),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.team.findMany({
        where,
        select: TEAM_SELECT,
        orderBy: [{ name: "asc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.team.count({ where }),
    ]);
    return { rows, total };
  }

  async findTeamById(tenantId: string, id: string): Promise<TeamRow | null> {
    return this.prisma.client.team.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: TEAM_SELECT,
    });
  }

  async findTeamByName(tenantId: string, name: string): Promise<{ id: string } | null> {
    return this.prisma.client.team.findFirst({
      where: { tenantId, name, deletedAt: null },
      select: { id: true },
    });
  }

  async listMembers(tenantId: string, teamId: string): Promise<PersonRow[]> {
    return this.prisma.client.user.findMany({
      where: { tenantId, teamId, deletedAt: null },
      select: PERSON_SELECT,
      orderBy: [{ name: "asc" }],
    });
  }

  async createTeam(
    tenantId: string,
    data: { name: string; managerUserId: string | null; leadUserId: string | null; branchId: string | null; active: boolean },
  ): Promise<TeamRow> {
    return this.prisma.client.team.create({
      data: { tenantId, ...data },
      select: TEAM_SELECT,
    });
  }

  async updateTeam(
    tenantId: string,
    id: string,
    patch: Partial<{ name: string; managerUserId: string | null; leadUserId: string | null; branchId: string | null; active: boolean }>,
  ): Promise<TeamRow> {
    await this.prisma.client.team.updateMany({ where: { id, tenantId, deletedAt: null }, data: patch });
    const row = await this.findTeamById(tenantId, id);
    if (!row) throw new Error("Team vanished mid-update");
    return row;
  }

  async softDeleteTeam(tenantId: string, id: string): Promise<number> {
    const result = await this.prisma.client.team.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  // ── Membership ───────────────────────────────────────────────────────────

  /**
   * Replace a team's roster in one transaction.
   *
   * Membership is a column on `users`, so "set the roster" is two updateManys: clear whoever
   * is on this team and no longer listed, then claim whoever is listed. The second one moves
   * a person who was on ANOTHER team — which is exactly right, since membership is exactly
   * one team and the last write is the staff member's intent.
   */
  async setMembers(tenantId: string, teamId: string, userIds: string[]): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { tenantId, teamId, id: { notIn: userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"] } },
        data: { teamId: null },
      });
      if (userIds.length > 0) {
        await tx.user.updateMany({
          where: { tenantId, id: { in: userIds }, deletedAt: null },
          data: { teamId },
        });
      }
    });
  }

  /** Detach every member when a team is disbanded, so nobody keeps a pointer to a dead row. */
  async clearMembers(tenantId: string, teamId: string): Promise<void> {
    await this.prisma.client.user.updateMany({
      where: { tenantId, teamId },
      data: { teamId: null },
    });
  }

  /** Staff (non-student) users, for the manager/lead/member pickers. */
  async listAssignableStaff(tenantId: string): Promise<Array<PersonRow & { teamId: string | null }>> {
    return this.prisma.client.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: "active",
        userRoles: { some: { deletedAt: null, role: { key: { not: "student" }, deletedAt: null } } },
      },
      select: { ...PERSON_SELECT, teamId: true },
      orderBy: [{ name: "asc" }],
    });
  }

  async findUsersByIds(tenantId: string, ids: string[]): Promise<PersonRow[]> {
    if (ids.length === 0) return [];
    return this.prisma.client.user.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null },
      select: PERSON_SELECT,
    });
  }

  // ── Position resolution ──────────────────────────────────────────────────

  /**
   * Everything needed to answer "who approves this person's leave", in one round trip.
   *
   * Reads the user's own team (with its lead and manager), the teams they lead, the teams
   * they manage, and whether they hold the `hr` role. The three list halves are what let the
   * chain skip a step when the applicant IS the lead or manager.
   */
  async findPosition(tenantId: string, userId: string): Promise<OrgPositionRow> {
    const [user, ledTeams, managedTeams] = await Promise.all([
      this.prisma.client.user.findFirst({
        where: { id: userId, tenantId, deletedAt: null },
        select: {
          team: {
            select: {
              id: true,
              name: true,
              deletedAt: true,
              lead: { select: PERSON_SELECT },
              manager: { select: PERSON_SELECT },
            },
          },
          // Both authority roles in one read. `select: { role: { key } }` rather than two
          // filtered queries, so adding a third authority role later is one line here.
          userRoles: {
            where: { deletedAt: null, role: { key: { in: ["hr", "super_admin"] }, deletedAt: null } },
            select: { role: { select: { key: true } } },
          },
        },
      }),
      this.prisma.client.team.findMany({
        where: { tenantId, leadUserId: userId, deletedAt: null, active: true },
        // The lead's own team is also their approval home (see below), so this needs the
        // manager and lead pointers, not just the id.
        select: { id: true, name: true, lead: { select: PERSON_SELECT }, manager: { select: PERSON_SELECT } },
        orderBy: [{ name: "asc" }],
      }),
      this.prisma.client.team.findMany({
        where: { tenantId, managerUserId: userId, deletedAt: null, active: true },
        select: { id: true },
      }),
    ]);

    // A soft-deleted team must read as "no team": the row is still pointed at by
    // `users.team_id` until somebody reassigns, and a disbanded team has no live approvers.
    const memberTeam = user?.team && user.team.deletedAt === null ? user.team : null;

    // A TEAM LEAD IS NOT A MEMBER OF THEIR OWN TEAM — `validateTeamAssignment` forbids it,
    // precisely so they never end up approving themselves. That leaves their `users.team_id`
    // null, and without this line their leave would fall through to the HR fallback instead
    // of reaching their manager, which is the rule. So a team they LEAD takes precedence as
    // their approval home; `resolveLeaveApprovalChain` then sees applicantId === leadUserId,
    // skips the lead step, and routes to that team's manager.
    //
    // Leading more than one team is allowed, and the tie is broken by name so the answer is
    // stable rather than dependent on row order — an approver that changed between two reads
    // would be worse than an arbitrary but fixed one.
    const team = ledTeams[0] ?? memberTeam;

    return {
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      leadUserId: team?.lead?.id ?? null,
      leadName: team?.lead?.name ?? null,
      managerUserId: team?.manager?.id ?? null,
      managerName: team?.manager?.name ?? null,
      leadsTeamIds: ledTeams.map((t) => t.id),
      managesTeamIds: managedTeams.map((t) => t.id),
      isHr: (user?.userRoles ?? []).some((r) => r.role.key === "hr"),
      isOwner: (user?.userRoles ?? []).some((r) => r.role.key === "super_admin"),
    };
  }

  /**
   * Every user id whose leave this actor may act on: members and leads of the teams they
   * manage, plus members of the teams they lead. Never includes the actor themselves —
   * nobody approves their own request, and the caller does not have to remember to strip it.
   */
  async listSubordinateUserIds(tenantId: string, actorId: string): Promise<string[]> {
    const teams = await this.prisma.client.team.findMany({
      where: {
        tenantId,
        deletedAt: null,
        active: true,
        OR: [{ leadUserId: actorId }, { managerUserId: actorId }],
      },
      select: { id: true, leadUserId: true, managerUserId: true },
    });
    if (teams.length === 0) return [];

    const members = await this.prisma.client.user.findMany({
      where: { tenantId, deletedAt: null, teamId: { in: teams.map((t) => t.id) } },
      select: { id: true },
    });

    const ids = new Set<string>(members.map((m) => m.id));
    // A manager also signs off the leads of the teams they manage — those leads are not
    // members of their own team (validateTeamAssignment forbids it), so they must be added
    // explicitly or a lead's own leave would reach nobody.
    for (const team of teams) {
      if (team.managerUserId === actorId && team.leadUserId) ids.add(team.leadUserId);
    }
    ids.delete(actorId);
    return [...ids];
  }

  /**
   * Everyone in this person's immediate circle: their team-mates, plus that team's lead and
   * manager. Used by the calendar's "My team" filter (P17-5).
   *
   * Deliberately WIDER than `listSubordinateUserIds`, and for a different purpose. That one
   * answers "whose leave may I decide" and looks DOWN the chart. This answers "whose absence
   * affects my week" and looks SIDEWAYS and UP — an ordinary member needs to know their lead
   * is away, even though they will never approve their lead's leave.
   *
   * A lead or manager who is not a member of any team still gets the teams they run.
   */
  async listTeamCircleUserIds(tenantId: string, userId: string): Promise<string[]> {
    const [self, ledOrManaged] = await Promise.all([
      this.prisma.client.user.findFirst({
        where: { id: userId, tenantId, deletedAt: null },
        select: { teamId: true },
      }),
      this.prisma.client.team.findMany({
        where: {
          tenantId,
          deletedAt: null,
          active: true,
          OR: [{ leadUserId: userId }, { managerUserId: userId }],
        },
        select: { id: true },
      }),
    ]);

    const teamIds = [...new Set([...(self?.teamId ? [self.teamId] : []), ...ledOrManaged.map((t) => t.id)])];
    if (teamIds.length === 0) return [];

    const [teams, members] = await Promise.all([
      this.prisma.client.team.findMany({
        where: { id: { in: teamIds }, tenantId, deletedAt: null },
        select: { leadUserId: true, managerUserId: true },
      }),
      this.prisma.client.user.findMany({
        where: { tenantId, deletedAt: null, teamId: { in: teamIds } },
        select: { id: true },
      }),
    ]);

    const ids = new Set<string>(members.map((m) => m.id));
    for (const team of teams) {
      if (team.leadUserId) ids.add(team.leadUserId);
      if (team.managerUserId) ids.add(team.managerUserId);
    }
    return [...ids];
  }

  /** Active users holding a given role key — the HR / super_admin fallback fan-out. */
  async listUsersWithRole(tenantId: string, roleKey: string): Promise<PersonRow[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: {
        deletedAt: null,
        role: { tenantId, key: roleKey, deletedAt: null },
        user: { tenantId, deletedAt: null, status: "active" },
      },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });
    // A user holding the role through more than one branch-scoped assignment would appear
    // twice, and would then be emailed twice about the same request.
    const byId = new Map(rows.map((row) => [row.userId, { id: row.userId, ...row.user }]));
    return [...byId.values()];
  }
}
