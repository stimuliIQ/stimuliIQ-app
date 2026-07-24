// apps/api/src/modules/enrollments/enrollments.service.ts
//
// Business logic for the enrollment roster join (docs/04-trd-architecture.md §2.1, P1
// scope: no commerce — docs/plans/phase-1.md). Owns:
//   - the enroll-or-hard-restore decision (unique-constraint contract, see
//     ../enrollments/enrollments.repository.ts file header)
//   - capacity checks against `batches.capacity`
//   - same-tenant student/batch/program validation
//   - scope resolution: "branch"/"assigned" both resolve via a join through `batches`
//     (enrollments has no direct branchId/facultyId column)
//
// IDOR / object-level authz: any GET/move/withdraw by :id re-verifies the row is in the
// caller's tenant AND resolved scope before acting; out-of-scope/out-of-tenant ids return
// 404 (not 403) — consistent with batches/students/faculty.

import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Enrollment } from "@repo/types";
import { EnrollmentsRepository, type EnrollmentRow } from "./enrollments.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { LmsAccountProvisioningService } from "../students/lms-account-provisioning.service";
import type { CreateEnrollmentRequest, ListEnrollmentsQuery, MoveEnrollmentRequest, WithdrawEnrollmentRequest } from "./dto";

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    private readonly repository: EnrollmentsRepository,
    // lifecycle-redesign P3: on a successful enrollment, auto-provision the student's LMS
    // login (idempotent + non-destructive — see the service for the safety contract).
    private readonly lmsProvisioning: LmsAccountProvisioningService,
  ) {}

  /** Resolves the current scope into a batch-id restriction for the list endpoint. Empty object = no restriction (scope "all"). */
  private async resolveListRestriction(actorId: string, tenantId: string): Promise<{ restrictToBatchIds?: string[] }> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.repository.listCallerBranchIds(actorId);
        const batchIds = await this.repository.listBatchIdsForBranches(tenantId, branchIds);
        // No branches/batches visible -> restrict to an empty list (filters to zero rows,
        // never "all").
        return { restrictToBatchIds: batchIds };
      }
      case "assigned": {
        const facultyId = await this.repository.findOwnFacultyProfileId(tenantId, actorId);
        if (!facultyId) {
          return { restrictToBatchIds: [] };
        }
        const batchIds = await this.repository.listBatchIdsForFaculty(tenantId, facultyId);
        return { restrictToBatchIds: batchIds };
      }
      case "own":
      default:
        throw new ForbiddenException({
          code: "enrollments.scope_unresolvable",
          title: "Scope not yet supported",
          detail: `The "${scope.scope}" data-scope is not seeded/resolvable for the enrollments module in P1.`,
        });
    }
  }

  /** Same scope resolution, for a single-row (by id) lookup — returns the set of batch ids the row's `batchId` must be in. */
  private async resolveObjectRestriction(actorId: string, tenantId: string): Promise<{ batchIds?: string[] }> {
    const restriction = await this.resolveListRestriction(actorId, tenantId);
    return { batchIds: restriction.restrictToBatchIds };
  }

  private assertRowInScope(row: EnrollmentRow & { batchId: string }, restriction: { batchIds?: string[] }): void {
    if (restriction.batchIds && !restriction.batchIds.includes(row.batchId)) {
      throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found" });
    }
  }

  async list(tenantId: string, actorId: string, query: ListEnrollmentsQuery): Promise<PaginatedResult<Enrollment>> {
    const restriction = await this.resolveListRestriction(actorId, tenantId);

    const { rows, total } = await this.repository.list({
      tenantId,
      studentId: query.studentId,
      batchId: query.batchId,
      programId: query.programId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
      restrictToBatchIds: restriction.restrictToBatchIds,
    });

    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, actorId: string, id: string): Promise<Enrollment> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) {
      throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId, tenantId);
    this.assertRowInScope(row, restriction);
    return toDto(row);
  }

  /**
   * Enrolls a student into a batch. Validates same-tenant student+batch, capacity, and
   * (for branch-scoped callers) that the batch is within the caller's branch — then
   * delegates the actual write to `EnrollmentsRepository.enrollOrRestore()`, which
   * transactionally either restores a previously soft-deleted (studentId, batchId) row
   * or creates a new one (see the repository's file header for why this MUST be a
   * restore, not a second insert, when a prior soft-deleted row exists).
   */
  async enroll(tenantId: string, actorId: string, body: CreateEnrollmentRequest): Promise<Enrollment> {
    const scope = requireScopeContext();

    const studentOk = await this.repository.studentExists(tenantId, body.studentId);
    if (!studentOk) {
      throw new NotFoundException({ code: "enrollments.student_not_found", title: "Student not found" });
    }

    const batch = await this.repository.findBatchForEnrollment(tenantId, body.batchId);
    if (!batch) {
      throw new NotFoundException({ code: "enrollments.batch_not_found", title: "Batch not found" });
    }

    if (scope.scope === "branch") {
      const branchIds = await this.repository.listCallerBranchIds(actorId);
      if (!branchIds.includes(batch.branchId)) {
        throw new ForbiddenException({
          code: "enrollments.branch_out_of_scope",
          title: "Branch out of scope",
          detail: "Branch managers may only enroll students into batches within their own branch.",
        });
      }
    } else if (scope.scope === "assigned") {
      const facultyId = await this.repository.findOwnFacultyProfileId(tenantId, actorId);
      if (!facultyId || batch.facultyId !== facultyId) {
        throw new ForbiddenException({
          code: "enrollments.batch_out_of_scope",
          title: "Batch out of scope",
          detail: "Faculty may only enroll students into batches assigned to them.",
        });
      }
    } else if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "enrollments.scope_unresolvable",
        title: "Scope not yet supported",
        detail: `The "${scope.scope}" data-scope cannot create enrollments.`,
      });
    }

    // ENTITLEMENT gate (integrity): a student may only be placed into a batch whose PROGRAM
    // they have a paid order for. This is the real fix for the manual roster path bypassing
    // the commerce funnel — the CRM removed the free "Enroll student" button, but the rule
    // must be enforced SERVER-SIDE (CLAUDE.md §3.5), not just hidden in the UI. The only way
    // to create a paid order is the checkout flow (online Razorpay OR an offline manual
    // payment recorded against an order), so "always require a paid order" holds for both.
    // Checked against the requested batch's program; auto-spill only ever routes within the
    // same program+branch, so the entitlement is identical for the spillover target.
    const entitled = await this.repository.hasPaidOrderForProgram(tenantId, body.studentId, batch.programId);
    if (!entitled) {
      throw new ConflictException({
        code: "enrollments.payment_required",
        title: "No paid order for this program",
        detail:
          "This student has no paid order for this batch's program. Assign the program and record payment (online or manual) before enrolling them into a batch.",
      });
    }

    // Capacity check: only count rows that are NOT this exact (studentId, batchId) pair
    // being restored (a re-enrollment of a previously withdrawn student into the SAME
    // batch should not be blocked by the batch being "full" of unrelated students if the
    // restored row itself would not increase net headcount beyond capacity — but since
    // this is P1's simple model, the active+completed count already excludes soft-deleted
    // rows, so a withdrawn student's row by definition is not counted here, and restoring
    // it correctly competes for the same capacity check as a brand-new enrollment).
    // Capacity: by default a full batch rejects (409). With autoSpillOnFull the student is
    // instead routed to the next available batch of the same program+branch (P4).
    let targetBatchId = body.batchId;
    let targetProgramId = batch.programId;
    const activeCount = await this.repository.countActiveEnrollments(body.batchId);
    if (activeCount >= batch.capacity) {
      if (!body.autoSpillOnFull) {
        throw new ConflictException({
          code: "enrollments.batch_full",
          title: "Batch is at capacity",
          detail: `This batch has reached its capacity of ${batch.capacity}.`,
        });
      }
      const spillover = await this.resolveSpilloverBatch(tenantId, body.batchId, batch);
      targetBatchId = spillover.batchId;
      targetProgramId = spillover.programId;
    }

    const result = await this.repository.enrollOrRestore(tenantId, {
      studentId: body.studentId,
      batchId: targetBatchId,
      programId: targetProgramId,
    });

    const row = await this.repository.findById(tenantId, result.id);
    if (!row) {
      throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found after enroll" });
    }

    // Auto-provision the LMS login now that the student has been assigned to a batch
    // (lifecycle-redesign P3). Best-effort: a provisioning/email failure must NOT roll
    // back a committed enrollment — it's logged and left for retry (idempotent).
    try {
      await this.lmsProvisioning.provisionForStudentProfile(tenantId, body.studentId);
    } catch (err) {
      this.logger.error(
        `[Enrollments] LMS provisioning failed for student=${body.studentId}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    return toDto(row);
  }

  /**
   * Resolve where an auto-spilling enrollment should land when its requested batch is full
   * (lifecycle-redesign P4). Prefers an EXISTING non-full sibling batch of the same
   * program+branch (soonest start first); if none has room, auto-creates the next batch by
   * cloning the full batch as a template (capacity/mode/schedule/faculty/branch) with a
   * derived "Section N" name. Runs "without manual intervention" per the brief.
   *
   * The tiny race window (a sibling filling between the load query and the write) is
   * acceptable for P4: a freshly-created batch is always empty, and the worst case is a
   * batch that briefly exceeds capacity by one — never a hard failure.
   */
  private async resolveSpilloverBatch(
    tenantId: string,
    sourceBatchId: string,
    source: { programId: string; branchId: string },
  ): Promise<{ batchId: string; programId: string }> {
    const siblings = await this.repository.listSiblingBatchesWithLoad(
      tenantId,
      source.programId,
      source.branchId,
      sourceBatchId,
    );
    const withRoom = siblings.find((b) => b.load < b.capacity);
    if (withRoom) {
      return { batchId: withRoom.id, programId: source.programId };
    }

    // No sibling has room — auto-create the next batch from the full one as a template.
    const template = await this.repository.findBatchTemplate(tenantId, sourceBatchId);
    if (!template) {
      // Should not happen (the batch was just validated), but fail loudly rather than
      // silently enrolling into a full batch.
      throw new NotFoundException({ code: "enrollments.batch_not_found", title: "Batch not found" });
    }
    const siblingCount = await this.repository.countSiblingBatches(tenantId, source.programId, source.branchId);
    const name = `${template.name} · Section ${siblingCount + 1}`;
    const created = await this.repository.createSpilloverBatch(tenantId, template, name);
    this.logger.log(
      `[Enrollments] auto-spill: batch=${sourceBatchId} full → created batch=${created.id} ("${name}")`,
    );
    return { batchId: created.id, programId: template.programId };
  }

  /**
   * Moves a student to a different batch. Implemented as an in-place `batchId` update on
   * the existing enrollment row (not close-old/open-new) — see @repo/types crm/
   * enrollments.schemas.ts file header for why either implementation satisfies the
   * contract; this choice keeps a single enrollment id/history per student-program
   * lifecycle, which is simpler for P1's roster/reporting-only scope.
   */
  async move(tenantId: string, actorId: string, id: string, body: MoveEnrollmentRequest): Promise<Enrollment> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId, tenantId);
    this.assertRowInScope(existing, restriction);

    const toBatch = await this.repository.findBatchForEnrollment(tenantId, body.toBatchId);
    if (!toBatch) {
      throw new NotFoundException({ code: "enrollments.batch_not_found", title: "Target batch not found" });
    }

    const scope = requireScopeContext();
    if (scope.scope === "branch") {
      const branchIds = await this.repository.listCallerBranchIds(actorId);
      if (!branchIds.includes(toBatch.branchId)) {
        throw new ForbiddenException({
          code: "enrollments.branch_out_of_scope",
          title: "Branch out of scope",
          detail: "Branch managers may only move students into batches within their own branch.",
        });
      }
    } else if (scope.scope === "assigned") {
      const facultyId = await this.repository.findOwnFacultyProfileId(tenantId, actorId);
      if (!facultyId || toBatch.facultyId !== facultyId) {
        throw new ForbiddenException({
          code: "enrollments.batch_out_of_scope",
          title: "Batch out of scope",
          detail: "Faculty may only move students into batches assigned to them.",
        });
      }
    }

    if (body.toBatchId === existing.batchId) {
      throw new ConflictException({
        code: "enrollments.same_batch",
        title: "Already enrolled in this batch",
        detail: "The student is already enrolled in the target batch.",
      });
    }

    // ENTITLEMENT gate (integrity): moving to a batch of a DIFFERENT program changes the
    // student's program — the same "always require a paid order" rule as enroll() applies,
    // otherwise `move` would be a back door around the payment guard. Same-program moves
    // (the common case — re-slotting a paid student into another cohort) are unaffected.
    if (toBatch.programId !== existing.programId) {
      const entitled = await this.repository.hasPaidOrderForProgram(tenantId, existing.studentId, toBatch.programId);
      if (!entitled) {
        throw new ConflictException({
          code: "enrollments.payment_required",
          title: "No paid order for the target program",
          detail:
            "Moving this student to a batch of a different program requires a paid order for that program. Assign the program and record payment (online or manual) first.",
        });
      }
    }

    // Moving INTO `toBatchId` is subject to the same unique-constraint contract as a
    // fresh enroll: if the student previously had a (now soft-deleted) enrollment row for
    // `toBatchId`, an in-place `batchId` update on THIS row would still collide with that
    // other row's full-column unique index. Detect and hard-restore that row instead,
    // then soft-delete the row being moved away from, so the net effect is identical to a
    // close-old/open-new move without violating the unique constraint.
    const collision = await this.repository.findExisting(tenantId, existing.studentId, body.toBatchId);
    if (collision && collision.deletedAt) {
      const activeCount = await this.repository.countActiveEnrollments(body.toBatchId);
      if (activeCount >= toBatch.capacity) {
        throw new ConflictException({
          code: "enrollments.batch_full",
          title: "Batch is at capacity",
          detail: `This batch has reached its capacity of ${toBatch.capacity}.`,
        });
      }
      await this.repository.restoreAsActive(collision.id);
      await this.repository.softDelete(existing.id);
      const moved = await this.repository.findById(tenantId, collision.id);
      if (!moved) {
        throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found after move" });
      }
      return toDto(moved);
    }
    if (collision && !collision.deletedAt) {
      throw new ConflictException({
        code: "enrollments.already_enrolled",
        title: "Already enrolled in the target batch",
        detail: "The student already has an active enrollment in the target batch.",
      });
    }

    const activeCount = await this.repository.countActiveEnrollments(body.toBatchId);
    if (activeCount >= toBatch.capacity) {
      throw new ConflictException({
        code: "enrollments.batch_full",
        title: "Batch is at capacity",
        detail: `This batch has reached its capacity of ${toBatch.capacity}.`,
      });
    }

    await this.repository.updateBatch(existing.id, body.toBatchId, toBatch.programId);
    const moved = await this.repository.findById(tenantId, existing.id);
    if (!moved) {
      throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found after move" });
    }
    return toDto(moved);
  }

  async withdraw(tenantId: string, actorId: string, id: string, _body: WithdrawEnrollmentRequest): Promise<Enrollment> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId, tenantId);
    this.assertRowInScope(existing, restriction);

    await this.repository.updateStatus(id, "dropped");
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) {
      throw new NotFoundException({ code: "enrollments.not_found", title: "Enrollment not found after withdraw" });
    }
    return toDto(updated);
  }
}

function toDto(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    batchId: row.batchId,
    batchName: row.batchName,
    programId: row.programId,
    programTitle: row.programTitle,
    status: row.status as Enrollment["status"],
    progressPct: row.progressPct,
    enrolledAt: row.enrolledAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
