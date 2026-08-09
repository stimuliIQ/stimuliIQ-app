// apps/api/src/modules/leads/activities.service.ts
//
// Business logic for activities (logged call/note/whatsapp/email/task records — these
// are LOGGED, not sent: docs/plans/phase-2.md task #6 explicitly excludes Mail/WhatsApp
// provider wiring for this record-keeping feature). Owns the scope-inheritance rule and
// the "complete task" state transition.
//
// SCOPE INHERITANCE: an activity has no owner/branch column. Visibility is inherited via
// its parent record:
//   - `leadId` present -> inherit the LEAD's scope-resolved where-fragment (same mapping
//      as LeadsService.resolveScopeWhere, applied to the `lead` relation).
//   - `studentId` present (no leadId) -> visible to "all"/"branch"/"assigned" callers
//      (students are tenant data, not owner-scoped); for "own" callers, restricted to
//      activities they personally logged (`userId = me`) — a counsellor's "own" scope on
//      leads does not automatically extend to every activity on a converted student.
//   - neither present is impossible by the DTO contract (CreateActivityRequestSchema
//      requires exactly one of leadId/studentId).
// "My tasks" views additionally allow `userId = me` regardless of the lead/student scope,
// since a task assigned to you is yours to see even if you are not the lead's owner.

import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { ActivityDetail } from "@repo/types";
import { ActivitiesRepository, type ActivityRow, type ActivityScopeWhere } from "./activities.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext, type ScopeContext } from "../auth/lib/scope-context";
import { LeadsRepository, type LeadScopeWhere } from "./leads.repository";
import type { CreateActivityRequest, CompleteTaskRequest, ListActivitiesQuery } from "./dto";

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly repository: ActivitiesRepository,
    private readonly leadsRepository: LeadsRepository,
  ) {}

  /** Mirrors LeadsService.resolveScopeWhere, but expressed against the `lead` relation on Activity. */
  private async resolveLeadScopeWhere(scope: ScopeContext): Promise<LeadScopeWhere> {
    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.leadsRepository.listCallerBranchIds(scope.actorId);
        return { branchId: { in: branchIds } };
      }
      case "assigned": {
        const branchIds = await this.leadsRepository.listCallerBranchIds(scope.actorId);
        return { OR: [{ ownerId: scope.actorId }, { branchId: { in: branchIds } }] };
      }
      case "own":
        return { ownerId: scope.actorId };
      default:
        throw new ForbiddenException({
          code: "activities.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope is not resolvable for the activities module.`,
        });
    }
  }

  /**
   * Builds the Activity-model where-fragment for the current scope: leads inherit their
   * parent lead's scope; student-only activities (no lead) fall back to "logged by me"
   * for "own" scope, and are otherwise unrestricted (tenant-wide) for all other scopes —
   * see file header. `userId = me` is OR'd in unconditionally so "my tasks" always
   * surface regardless of lead ownership.
   */
  private async resolveScopeWhere(scope: ScopeContext): Promise<ActivityScopeWhere> {
    const leadScope = await this.resolveLeadScopeWhere(scope);
    const studentOnlyFragment = scope.scope === "own" ? { userId: scope.actorId } : {};

    return {
      OR: [
        { leadId: null, studentId: { not: null }, ...studentOnlyFragment },
        { leadId: { not: null }, lead: leadScope },
        { userId: scope.actorId }, // always see activities/tasks you personally logged or own as a task.
      ],
    };
  }

  async list(tenantId: string, query: ListActivitiesQuery): Promise<PaginatedResult<ActivityDetail>> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);

    const { rows, total } = await this.repository.list({
      tenantId,
      leadId: query.leadId,
      studentId: query.studentId,
      userId: query.userId,
      type: query.type,
      dueBefore: query.dueBefore ? new Date(query.dueBefore) : undefined,
      doneOnly: query.doneOnly,
      pendingTasks: query.pendingTasks,
      page: query.page,
      pageSize: query.pageSize,
      scopeWhere,
    });

    return new PaginatedResult(rows.map(toDetail), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<ActivityDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const row = await this.repository.findById(tenantId, id, scopeWhere);
    if (!row) {
      throw new NotFoundException({ code: "activities.not_found", title: "Activity not found" });
    }
    return toDetail(row);
  }

  /** If `leadId` is given, verifies the lead is in the caller's scope BEFORE logging the activity (so a counsellor cannot log activity against a lead they cannot see). */
  async create(tenantId: string, actorId: string, body: CreateActivityRequest): Promise<ActivityDetail> {
    if (body.leadId) {
      const scope = requireScopeContext();
      const leadScopeWhere = await this.resolveLeadScopeWhere(scope);
      const lead = await this.leadsRepository.findById(tenantId, body.leadId, leadScopeWhere);
      if (!lead) {
        throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
      }
    }

    const created = await this.repository.create({
      tenantId,
      leadId: body.leadId,
      studentId: body.studentId,
      userId: actorId,
      type: body.type,
      payload: body.payload,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
    });

    // Stamp the parent lead's contact timestamps. This is the ONLY place
    // `firstContactedAt` is ever written, which is what makes first-response-time a real
    // measurement rather than an estimate: it is set by the act of logging contact, not
    // by anyone remembering to record it separately.
    //
    // A `task` is excluded from counting as CONTACT — scheduling a callback for Friday is
    // not talking to the lead, and letting it stamp first contact would let a rep book a
    // reminder and score a perfect response time without ever picking up the phone. It
    // still moves `lastActivityAt`, since it is genuine activity on the record.
    if (body.leadId) {
      await this.leadsRepository.touchLeadContact(body.leadId, new Date(), body.type !== "task");
    }

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "activities.not_found", title: "Activity not found after creation" });
    return toDetail(row);
  }

  /** POST /crm/activities/:id/complete — only valid for `type = "task"` records; sets `doneAt` and merges any provided notes into the existing payload (read-then-write to avoid clobbering). */
  async completeTask(tenantId: string, id: string, body: CompleteTaskRequest): Promise<ActivityDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere);
    if (!existing) {
      throw new NotFoundException({ code: "activities.not_found", title: "Activity not found" });
    }
    if (existing.type !== "task") {
      throw new UnprocessableEntityException({
        code: "activities.not_a_task",
        title: "Only task activities can be completed",
        detail: `Activity ${id} is of type "${existing.type}", not "task".`,
      });
    }
    if (existing.doneAt) {
      throw new UnprocessableEntityException({
        code: "activities.already_done",
        title: "Task already completed",
      });
    }

    const doneAt = body.doneAt ? new Date(body.doneAt) : new Date();
    const mergedPayload = {
      ...(typeof existing.payload === "object" && existing.payload !== null ? existing.payload : {}),
      ...(body.notes !== undefined ? { completionNotes: body.notes } : {}),
    };

    await this.repository.updatePayload(id, mergedPayload, doneAt);

    const updated = await this.repository.findById(tenantId, id, scopeWhere);
    if (!updated) throw new NotFoundException({ code: "activities.not_found", title: "Activity not found after completion" });
    return toDetail(updated);
  }
}

function toDetail(row: ActivityRow): ActivityDetail {
  return {
    id: row.id,
    type: row.type,
    payload: (row.payload as ActivityDetail["payload"]) ?? {},
    leadId: row.leadId,
    studentId: row.studentId,
    userId: row.userId,
    userName: row.userName,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
