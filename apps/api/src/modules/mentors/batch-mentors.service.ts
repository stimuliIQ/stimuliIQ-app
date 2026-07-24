// apps/api/src/modules/mentors/batch-mentors.service.ts
//
// Business logic for the mentor↔batch M:N assignment (WS-2, docs/specs/phase-8-mentor.md).
// No Prisma here beyond the P2002 error-shape check (CLAUDE.md §3.3) — the same accepted
// precedent as forum.service.ts/gamification.service.ts's `isUniqueViolation` helpers.
//
// SCOPE:
//   - GET  .../mentors        -> `batches.view` (AC-23: reuses the existing permission —
//     no separate "view" permission for reading the assignment list). Scope all|branch|
//     assigned, with "assigned" resolved via `batch_mentors` for a Mentor caller
//     (LOCK-2/Rule M-1), NOT `batches.facultyId`.
//   - POST/DELETE .../mentors -> `mentors.assign` (AC-17/AC-29 — distinct from
//     `mentors.edit`). Scope all|branch only (never granted to the Mentor role, Rule M-3)
//     — a Mentor can never assign/remove mentors, including themselves.
//
// BUSINESS-RULE ERROR CODES (mirrors mentors.schemas.ts file header):
//   422 MENTOR_NOT_ACTIVE       — assigning a prospective/inactive mentor (AC-18).
//   409 ALREADY_ASSIGNED        — duplicate active assignment, literal repeat (AC-19).
//   422 BATCH_NOT_ASSIGNABLE    — assign/lead-change on a completed/archived batch (AC-26).

import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AssignMentorToBatchRequest, MentorBatchAssignment, MentorBatchAssignmentList } from "@repo/types";
import { BatchMentorsRepository, type BatchMentorAssignmentRow, type BatchScopeRow } from "./batch-mentors.repository";
import { MentorsRepository } from "./mentors.repository";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { requireScopeContext } from "../auth/lib/scope-context";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Batch statuses mentors may be (re)assigned on — AC-26 blocks completed/archived. */
const ASSIGNABLE_BATCH_STATUSES = new Set(["planned", "active"]);

@Injectable()
export class BatchMentorsService {
  constructor(
    private readonly repository: BatchMentorsRepository,
    private readonly mentorsRepository: MentorsRepository,
    private readonly enrollmentScope: EnrollmentScopeRepository,
  ) {}

  /** `batches.view`/`batches.markComplete` scope resolution — shared with BatchCompletionService's identical shape. */
  private async resolveBatchRestriction(
    tenantId: string,
    actorId: string,
  ): Promise<{ branchIds?: string[]; assignedBatchIds?: string[] }> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch":
        return { branchIds: await this.repository.listCallerBranchIds(actorId) };
      case "assigned":
        return { assignedBatchIds: await this.enrollmentScope.resolveBatchIdsForMentor(tenantId, actorId) };
      case "own":
      default:
        throw new ForbiddenException({
          code: "batches.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope is not resolvable for batch-mentor assignment.`,
        });
    }
  }

  /** `mentors.assign` scope resolution — Rule M-3: never granted at assigned/own, only all|branch. */
  private async resolveAssignRestriction(actorId: string): Promise<{ branchIds?: string[] }> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch":
        return { branchIds: await this.repository.listCallerBranchIds(actorId) };
      case "assigned":
      case "own":
      default:
        throw new ForbiddenException({
          code: "mentors.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope cannot assign mentors to batches.`,
        });
    }
  }

  private assertBatchInScope(
    batch: BatchScopeRow,
    restriction: { branchIds?: string[]; assignedBatchIds?: string[] },
  ): void {
    if (restriction.branchIds && !restriction.branchIds.includes(batch.branchId)) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    if (restriction.assignedBatchIds && !restriction.assignedBatchIds.includes(batch.id)) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
  }

  /** GET /crm/batches/:id/mentors — AC-23. */
  async list(tenantId: string, actorId: string, batchId: string): Promise<MentorBatchAssignmentList> {
    const batch = await this.repository.findBatchScopeRow(tenantId, batchId);
    if (!batch) throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    const restriction = await this.resolveBatchRestriction(tenantId, actorId);
    this.assertBatchInScope(batch, restriction);

    const rows = await this.repository.listActiveForBatch(tenantId, batchId);
    return rows.map(toAssignmentDto);
  }

  /**
   * POST /crm/batches/:id/mentors — assign, or update the `isLead` flag on an existing
   * active assignment (see AssignMentorToBatchRequestSchema's doc comment for the full
   * decision tree, AC-19/AC-20/AC-21).
   */
  async assign(
    tenantId: string,
    actorId: string,
    batchId: string,
    body: AssignMentorToBatchRequest,
  ): Promise<MentorBatchAssignment> {
    const batch = await this.repository.findBatchScopeRow(tenantId, batchId);
    if (!batch) throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    const restriction = await this.resolveAssignRestriction(actorId);
    this.assertBatchInScope(batch, restriction);

    // AC-26: batch must be planned/active.
    if (!ASSIGNABLE_BATCH_STATUSES.has(batch.status)) {
      throw new UnprocessableEntityException({
        code: "BATCH_NOT_ASSIGNABLE",
        title: "Batch is not assignable",
        detail: "Mentors may only be (re)assigned while a batch is planned or active.",
      });
    }

    // Mentor must exist (in-tenant) — 404, not 422, for a bad/typo'd/deleted id (Part 4 edge case).
    const mentor = await this.mentorsRepository.findActiveAssignmentCandidate(tenantId, body.mentorId);
    if (!mentor) throw new NotFoundException({ code: "mentors.not_found", title: "Mentor not found" });

    // AC-18: only `active` mentors may be assigned.
    if (mentor.engagementStatus !== "active") {
      throw new UnprocessableEntityException({
        code: "MENTOR_NOT_ACTIVE",
        title: "Mentor is not active",
        detail: "Only mentors with engagementStatus='active' may be assigned to a batch.",
      });
    }

    const existing = await this.repository.findActiveByBatchAndMentor(tenantId, batchId, body.mentorId);

    if (existing) {
      // AC-19: a literal repeat (same isLead value) is a clean 409, not a duplicate write.
      if (existing.isLead === body.isLead) {
        throw new ConflictException({
          code: "ALREADY_ASSIGNED",
          title: "Mentor already assigned",
          detail: "This mentor is already actively assigned to this batch with the same lead flag.",
        });
      }
      // Otherwise: update the isLead flag in place (AC-21 lead-reassignment path).
      if (body.isLead) {
        await this.repository.clearOtherLeads(tenantId, batchId, existing.id);
      }
      await this.repository.updateIsLead(existing.id, body.isLead);
      const rows = await this.repository.listActiveForBatch(tenantId, batchId);
      const updated = rows.find((r) => r.batchMentorId === existing.id);
      if (!updated) throw new NotFoundException({ code: "batches.mentor_not_found", title: "Assignment not found after update" });
      return toAssignmentDto(updated);
    }

    // New assignment.
    if (body.isLead) {
      await this.repository.clearOtherLeads(tenantId, batchId);
    }

    try {
      const created = await this.repository.createAssignment({
        tenantId,
        batchId,
        mentorId: body.mentorId,
        isLead: body.isLead,
        assignedByUserId: actorId,
      });
      const rows = await this.repository.listActiveForBatch(tenantId, batchId);
      const row = rows.find((r) => r.batchMentorId === created.id);
      if (!row) throw new NotFoundException({ code: "batches.mentor_not_found", title: "Assignment not found after creation" });
      return toAssignmentDto(row);
    } catch (err) {
      // Race condition: two concurrent requests both passed the pre-check above. The
      // partial-unique index `batch_mentors_active_batch_mentor_key` (batch_id, mentor_id)
      // WHERE deleted_at IS NULL is the DB-level backstop — caught here as a clean 409,
      // never a 500 (Part 4 edge case: "idempotent outcome — exactly one active row exists").
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: "ALREADY_ASSIGNED",
          title: "Mentor already assigned",
          detail: "This mentor is already actively assigned to this batch (concurrent request).",
        });
      }
      throw err;
    }
  }

  /** DELETE /crm/batches/:id/mentors/:mentorId — AC-24/Rule M-5: soft-unassign. */
  async remove(tenantId: string, actorId: string, batchId: string, mentorId: string): Promise<MentorBatchAssignmentList> {
    const batch = await this.repository.findBatchScopeRow(tenantId, batchId);
    if (!batch) throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    const restriction = await this.resolveAssignRestriction(actorId);
    this.assertBatchInScope(batch, restriction);

    const existing = await this.repository.findActiveByBatchAndMentor(tenantId, batchId, mentorId);
    if (!existing) throw new NotFoundException({ code: "batches.mentor_not_found", title: "Assignment not found" });

    await this.repository.softRemove(existing.id);

    const rows = await this.repository.listActiveForBatch(tenantId, batchId);
    return rows.map(toAssignmentDto);
  }
}

function toAssignmentDto(row: BatchMentorAssignmentRow): MentorBatchAssignment {
  return {
    batchMentorId: row.batchMentorId,
    mentorId: row.mentorId,
    mentorFullName: row.mentorFullName,
    mentorEmail: row.mentorEmail,
    mentorExternalInstitute: row.mentorExternalInstitute,
    mentorEngagementStatus: row.mentorEngagementStatus as MentorBatchAssignment["mentorEngagementStatus"],
    isLead: row.isLead,
    assignedAt: row.assignedAt.toISOString(),
  };
}
