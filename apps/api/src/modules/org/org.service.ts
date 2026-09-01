// apps/api/src/modules/org/org.service.ts
//
// Business logic for the org hierarchy (docs/specs/org-teams.md, ADR-0069).
//
// Two audiences:
//   - the management screen (Organisation ▸ Teams) — team CRUD + roster;
//   - every module that needs to know who reports to whom, via `getPosition()`,
//     `resolveApprovalChain()` and `listSubordinateUserIds()`. Leave is the first caller.
//
// THE RULES THAT LIVE HERE, and why:
//   1. `validateTeamAssignment` (@repo/types) is run on every write. The CRM runs the same
//      function to show the problem before submit; this is the actual refuser.
//   2. A team's manager and lead are NOT members of it. Otherwise they would end up
//      approving their own leave — resolvable, but only by rules nobody can predict from
//      the org chart in front of them.
//   3. Disbanding a team detaches its members rather than cascading. A person is not
//      deleted because their team was, and a dangling `users.team_id` pointing at a
//      soft-deleted row would silently strand their approval chain.

import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CreateTeamRequest,
  ListTeamsQuery,
  MyOrgPosition,
  SetTeamMembersRequest,
  Team,
  TeamAssignmentIssueCode,
  TeamDetail,
  UpdateTeamRequest,
} from "@repo/types";
import { resolveLeaveApprovalChain, validateTeamAssignment, type LeaveApprovalChain } from "@repo/types";

import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { OrgRepository, type PersonRow, type TeamRow } from "./org.repository";

/** Copy for each assignment issue. Kept beside the codes so a new code cannot ship unworded. */
const ASSIGNMENT_ISSUE_DETAIL: Record<TeamAssignmentIssueCode, string> = {
  manager_is_lead:
    "The manager and the team lead must be different people — otherwise both approval steps are the same signature.",
  manager_is_member: "The manager cannot also be a member of the team they manage.",
  lead_is_member: "The team lead cannot also be listed as a member of their own team.",
};

@Injectable()
export class OrgService {
  constructor(private readonly repository: OrgRepository) {}

  /**
   * The org chart is tenant-wide configuration, not per-branch records — the same call
   * course types and colleges make. A branch-scoped caller editing it would be rewriting
   * every branch's reporting lines, so only scope=all may.
   */
  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "org.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for teams.`,
      });
    }
  }

  private notFound(): NotFoundException {
    // 404 rather than 403 for an out-of-tenant id, matching the posture everywhere else in
    // this codebase: a 403 confirms the row exists.
    return new NotFoundException({
      code: "org.team_not_found",
      title: "Team not found",
      detail: "That team doesn't exist, or has been disbanded.",
    });
  }

  private toDto(row: TeamRow): Team {
    return {
      id: row.id,
      name: row.name,
      manager: row.manager ?? null,
      lead: row.lead ?? null,
      branchId: row.branchId,
      branchName: row.branch?.name ?? null,
      active: row.active,
      memberCount: row._count.members,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Runs the shared rules and maps any issue to a 422 naming what is wrong.
   *
   * The issue CODES are deliberately not on the wire. This threw them as an `issues` array
   * until 2026-09-01, which read like a machine-readable contract and was not one:
   * HttpExceptionFilter builds the ProblemDetails envelope from `{ code, title, detail,
   * errors }` and drops every other key, so `issues` never reached a single client. Nothing
   * consumed it either — the CRM's team form runs `validateTeamAssignment` itself and
   * renders its own copy from the codes, which is what "one definition, run on both sides"
   * means here. `detail` carries the same information as a sentence per issue, and is the
   * half a client actually receives.
   */
  private assertAssignmentValid(input: {
    managerUserId: string | null;
    leadUserId: string | null;
    memberUserIds: string[];
  }): void {
    const issues = validateTeamAssignment(input);
    if (issues.length === 0) return;
    throw new UnprocessableEntityException({
      code: "org.invalid_team_assignment",
      title: "That combination isn't allowed",
      detail: issues.map((issue) => ASSIGNMENT_ISSUE_DETAIL[issue]).join(" "),
    });
  }

  // ── Teams ────────────────────────────────────────────────────────────────

  async list(tenantId: string, query: ListTeamsQuery): Promise<PaginatedResult<Team>> {
    const { rows, total } = await this.repository.listTeams({
      tenantId,
      q: query.q,
      active: query.active,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(
      rows.map((row) => this.toDto(row)),
      { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total },
    );
  }

  async get(tenantId: string, id: string): Promise<TeamDetail> {
    const row = await this.repository.findTeamById(tenantId, id);
    if (!row) throw this.notFound();
    const members = await this.repository.listMembers(tenantId, id);
    return { ...this.toDto(row), members };
  }

  async create(tenantId: string, body: CreateTeamRequest): Promise<Team> {
    this.assertAllScope();
    const name = body.name.trim();

    const clash = await this.repository.findTeamByName(tenantId, name);
    if (clash) {
      throw new ConflictException({
        code: "org.team_name_taken",
        title: "That name is already in use",
        detail: `A team called "${name}" already exists. Team names have to be unique so the org chart reads unambiguously.`,
      });
    }

    // A new team has no members yet, so only the manager-is-lead rule can fire here. It is
    // still run through the shared function rather than inlined, so there is one definition.
    this.assertAssignmentValid({
      managerUserId: body.managerUserId ?? null,
      leadUserId: body.leadUserId ?? null,
      memberUserIds: [],
    });

    const row = await this.repository.createTeam(tenantId, {
      name,
      managerUserId: body.managerUserId ?? null,
      leadUserId: body.leadUserId ?? null,
      branchId: body.branchId ?? null,
      active: body.active,
    });
    return this.toDto(row);
  }

  async update(tenantId: string, id: string, body: UpdateTeamRequest): Promise<Team> {
    this.assertAllScope();
    const existing = await this.repository.findTeamById(tenantId, id);
    if (!existing) throw this.notFound();

    const name = body.name?.trim();
    if (name && name !== existing.name) {
      const clash = await this.repository.findTeamByName(tenantId, name);
      if (clash && clash.id !== id) {
        throw new ConflictException({
          code: "org.team_name_taken",
          title: "That name is already in use",
          detail: `A team called "${name}" already exists.`,
        });
      }
    }

    // Validate against the roster as it actually stands — changing the lead to somebody who
    // is currently a member has to be refused, not silently accepted and then discovered.
    const members = await this.repository.listMembers(tenantId, id);
    this.assertAssignmentValid({
      managerUserId: body.managerUserId === undefined ? existing.manager?.id ?? null : body.managerUserId,
      leadUserId: body.leadUserId === undefined ? existing.lead?.id ?? null : body.leadUserId,
      memberUserIds: members.map((m) => m.id),
    });

    const row = await this.repository.updateTeam(tenantId, id, {
      ...(name === undefined ? {} : { name }),
      ...(body.managerUserId === undefined ? {} : { managerUserId: body.managerUserId }),
      ...(body.leadUserId === undefined ? {} : { leadUserId: body.leadUserId }),
      ...(body.branchId === undefined ? {} : { branchId: body.branchId }),
      ...(body.active === undefined ? {} : { active: body.active }),
    });
    return this.toDto(row);
  }

  /**
   * Disband a team. Members are DETACHED, never deleted — a person outlives the team they
   * were on, and leaving `users.team_id` pointing at a soft-deleted row would strand their
   * approval chain at a lead who no longer exists.
   */
  async remove(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findTeamById(tenantId, id);
    if (!existing) throw this.notFound();

    await this.repository.clearMembers(tenantId, id);
    const count = await this.repository.softDeleteTeam(tenantId, id);
    if (count === 0) throw this.notFound();
  }

  async setMembers(tenantId: string, id: string, body: SetTeamMembersRequest): Promise<TeamDetail> {
    this.assertAllScope();
    const existing = await this.repository.findTeamById(tenantId, id);
    if (!existing) throw this.notFound();

    const userIds = [...new Set(body.userIds)];

    // Every id must be a real, live user in this tenant. Silently dropping an unknown id
    // would leave the roster quietly smaller than what the person saved.
    const found = await this.repository.findUsersByIds(tenantId, userIds);
    if (found.length !== userIds.length) {
      throw new UnprocessableEntityException({
        code: "org.unknown_member",
        title: "Someone on that list isn't a live user",
        detail: "One or more of the people you selected no longer exists. Reload the team and try again.",
      });
    }

    this.assertAssignmentValid({
      managerUserId: existing.manager?.id ?? null,
      leadUserId: existing.lead?.id ?? null,
      memberUserIds: userIds,
    });

    await this.repository.setMembers(tenantId, id, userIds);
    return this.get(tenantId, id);
  }

  async listAssignableStaff(tenantId: string): Promise<Array<PersonRow & { teamId: string | null }>> {
    return this.repository.listAssignableStaff(tenantId);
  }

  // ── Position + approval chain (the reason the hierarchy exists) ───────────

  async getPosition(tenantId: string, userId: string): Promise<MyOrgPosition> {
    return this.repository.findPosition(tenantId, userId);
  }

  /**
   * Who approves this person's leave. The arithmetic lives in `@repo/types` so the CRM runs
   * the identical function; this only supplies the row.
   */
  async resolveApprovalChain(tenantId: string, userId: string): Promise<LeaveApprovalChain & { position: MyOrgPosition }> {
    const position = await this.repository.findPosition(tenantId, userId);
    const chain = resolveLeaveApprovalChain({
      applicantId: userId,
      isHr: position.isHr,
      managesAnyTeam: position.managesTeamIds.length > 0,
      team: position.teamId
        ? { id: position.teamId, leadUserId: position.leadUserId, managerUserId: position.managerUserId }
        : null,
    });
    return { ...chain, position };
  }

  /** Everyone whose leave this actor may act on, by virtue of leading or managing a team. */
  async listSubordinateUserIds(tenantId: string, actorId: string): Promise<string[]> {
    return this.repository.listSubordinateUserIds(tenantId, actorId);
  }

  /**
   * Everyone whose absence affects this person's week: their team-mates, their lead and
   * their manager. Wider than `listSubordinateUserIds` and for a different question — that
   * one looks DOWN the chart (whose leave may I decide), this looks sideways and UP.
   */
  async listTeamCircleUserIds(tenantId: string, userId: string): Promise<string[]> {
    return this.repository.listTeamCircleUserIds(tenantId, userId);
  }

  /** The company-wide fallback approvers: HR, with super_admin as the terminal backstop. */
  async listFallbackApprovers(tenantId: string): Promise<PersonRow[]> {
    const [hr, owners] = await Promise.all([
      this.repository.listUsersWithRole(tenantId, "hr"),
      this.repository.listUsersWithRole(tenantId, "super_admin"),
    ]);
    // super_admin is always included, never merely a fallback-if-no-HR. A request landing in
    // a queue nobody watches is the failure this list exists to prevent, and "we hired an HR
    // person who then went on leave" is exactly when that happens.
    const byId = new Map([...hr, ...owners].map((p) => [p.id, p]));
    return [...byId.values()];
  }
}
