// apps/api/src/modules/mentors/batch-completion.service.ts
//
// Business logic for the internship-completion rollup + mark-complete transition (WS-3,
// docs/specs/phase-8-mentor.md). No Prisma here (CLAUDE.md §3.3) beyond what
// `BatchCompletionRepository` supplies.
//
// LOCK-4/AC-31 (HEADLINE): every number here is a LIVE read of enrollments/
// lesson_progress/submissions/attempts/assessments/assignments/certificates — this
// service introduces ZERO new progress-computation logic. Per-student eligibility is
// delegated VERBATIM to `CertificatesService.isEligible` (the P4 eligibility engine,
// certificates.service.ts) — never re-derived or simplified here (AC-33).
//
// SCOPE: `batches.view` (GET .../completion, GET .../completion/students) and
// `batches.markComplete` (POST .../complete) both resolve scope identically —
// all|branch|assigned, with "assigned" resolved via `batch_mentors` for a Mentor caller
// (LOCK-2/Rule M-1, `EnrollmentScopeRepository.resolveBatchIdsForMentor`), mirroring
// `BatchMentorsService`'s identical restriction shape (small, deliberate duplication —
// same precedent as BatchesService/CertificatesService each owning their own scope
// resolution rather than a shared cross-cutting resolver class).
//
// COMPUTE COST NOTE (mirrors CertificatesService.listEligibility's existing precedent):
// the AGGREGATE rollup (getSummary) computes eligibility for every enrollment in the
// batch (no pagination possible for a true aggregate) — the same N+1-per-row cost
// `listEligibility` already accepts elsewhere in this codebase. The PAGINATED per-student
// endpoint (listStudents) computes eligibility ONLY for the current page's rows (DB-level
// pagination BEFORE eligibility computation), bounding cost to `pageSize` per request —
// the `bucket` query filter is applied AFTER that page is computed (same accepted
// limitation as `listEligibility`'s `eligible`/`hasRecommendation` filters: a page may
// return fewer than `pageSize` rows when combined with a post-computation filter).

import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  BatchCompletionBucket,
  BatchCompletionStudentRow,
  BatchCompletionSummaryDto,
  EligibilityResult,
  ListBatchCompletionStudentsQuery,
  MarkBatchCompleteResponse,
} from "@repo/types";
import {
  BatchCompletionRepository,
  type CompletionBatchRow,
  type CompletionEnrollmentRow,
} from "./batch-completion.repository";
import { CertificatesService } from "../certificates/certificates.service";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { requireScopeContext } from "../auth/lib/scope-context";
import { PaginatedResult } from "../../common/dto/paginated-result";

interface ComputedRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  status: CompletionEnrollmentRow["status"];
  progressPct: number;
  bucket: BatchCompletionBucket;
  eligibility: EligibilityResult;
  certificateStatus: "valid" | "revoked" | null;
  certificateId: string | null;
}

@Injectable()
export class BatchCompletionService {
  constructor(
    private readonly repository: BatchCompletionRepository,
    private readonly certificatesService: CertificatesService,
    private readonly enrollmentScope: EnrollmentScopeRepository,
  ) {}

  /** Shared scope resolution for `batches.view`/`batches.markComplete` — mirrors BatchMentorsService.resolveBatchRestriction. */
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
          detail: `The "${scope.scope}" data-scope is not resolvable for the batch completion rollup.`,
        });
    }
  }

  private assertBatchInScope(
    batch: CompletionBatchRow,
    restriction: { branchIds?: string[]; assignedBatchIds?: string[] },
  ): void {
    if (restriction.branchIds && !restriction.branchIds.includes(batch.branchId)) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    if (restriction.assignedBatchIds && !restriction.assignedBatchIds.includes(batch.id)) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
  }

  private async loadScopedBatch(tenantId: string, actorId: string, batchId: string): Promise<CompletionBatchRow> {
    const batch = await this.repository.findBatchRow(tenantId, batchId);
    if (!batch) throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    const restriction = await this.resolveBatchRestriction(tenantId, actorId);
    this.assertBatchInScope(batch, restriction);
    return batch;
  }

  /**
   * Computes bucket + eligibility + certificate status for a set of enrollment rows.
   * `dropped` status enrollments still get a REAL eligibility computation (the DTO
   * requires it on every row, AC-33) — the bucket itself is `dropped` regardless of the
   * eligibility outcome (Part 4 edge case: dropped status is authoritative/live, not
   * retroactively overridden by a stale certificate).
   */
  private async computeRows(
    tenantId: string,
    enrollments: CompletionEnrollmentRow[],
  ): Promise<ComputedRow[]> {
    if (enrollments.length === 0) return [];

    const certMap = await this.repository.findCertificatesForEnrollments(
      tenantId,
      enrollments.map((e) => e.id),
    );

    return Promise.all(
      enrollments.map(async (enrollment): Promise<ComputedRow> => {
        const elig = await this.certificatesService.isEligible(tenantId, enrollment.id);
        const eligibility: EligibilityResult = {
          eligible: elig.eligible,
          reasons: elig.reasons,
          recommendedAt: elig.recommendedAt ? elig.recommendedAt.toISOString() : null,
        };
        const cert = certMap.get(enrollment.id) ?? null;
        const hasValidCert = cert?.status === "valid";

        let bucket: BatchCompletionBucket;
        if (enrollment.status === "dropped") {
          bucket = "dropped";
        } else if (hasValidCert) {
          bucket = "certified";
        } else if (elig.eligible) {
          bucket = "eligibleNotIssued";
        } else {
          bucket = "inProgress";
        }

        return {
          enrollmentId: enrollment.id,
          studentId: enrollment.studentId,
          studentName: enrollment.studentName,
          status: enrollment.status,
          progressPct: enrollment.progressPct,
          bucket,
          eligibility,
          certificateStatus: (cert?.status as "valid" | "revoked" | undefined) ?? null,
          certificateId: cert?.id ?? null,
        };
      }),
    );
  }

  /** GET /crm/batches/:id/completion — AC-31 through AC-37. */
  async getSummary(tenantId: string, actorId: string, batchId: string): Promise<BatchCompletionSummaryDto> {
    const batch = await this.loadScopedBatch(tenantId, actorId, batchId);
    const enrollments = await this.repository.listEnrollments(tenantId, batchId);

    // AC-36: zero enrollments is a valid 200, all buckets 0, percentComplete null.
    if (enrollments.length === 0) {
      return {
        batchId: batch.id,
        batchName: batch.name,
        status: batch.status,
        completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
        totalActive: 0,
        certified: 0,
        eligibleNotIssued: 0,
        inProgress: 0,
        dropped: 0,
        percentComplete: null,
        assignmentsSubmittedPct: null,
        assessmentsPassedPct: null,
        finalProjectApprovedPct: null,
        canTransitionToComplete: batch.status === "active",
      };
    }

    const rows = await this.computeRows(tenantId, enrollments);
    const active = rows.filter((r) => r.status !== "dropped");
    const totalActive = active.length;

    const certified = rows.filter((r) => r.bucket === "certified").length;
    const eligibleNotIssued = rows.filter((r) => r.bucket === "eligibleNotIssued").length;
    const inProgress = rows.filter((r) => r.bucket === "inProgress").length;
    const dropped = rows.filter((r) => r.bucket === "dropped").length;

    const percentComplete =
      totalActive > 0 ? average(active.map((r) => r.progressPct)) : null;
    const assessmentsPassedPct =
      totalActive > 0
        ? percentTrue(active.map((r) => r.eligibility.reasons.requiredAssessmentsPassed))
        : null;
    const finalProjectApprovedPct =
      totalActive > 0
        ? percentTrue(active.map((r) => r.eligibility.reasons.finalProjectApproved))
        : null;

    let assignmentsSubmittedPct: number | null = null;
    if (totalActive > 0) {
      const nonProjectAssignmentIds = await this.repository.listNonProjectAssignmentIds(
        tenantId,
        batch.programId,
      );
      const denominator = totalActive * nonProjectAssignmentIds.length;
      if (denominator > 0) {
        const submitted = await this.repository.countDistinctSubmittedPairs(
          tenantId,
          active.map((r) => r.enrollmentId),
          nonProjectAssignmentIds,
        );
        assignmentsSubmittedPct = clampPct((submitted / denominator) * 100);
      }
    }

    return {
      batchId: batch.id,
      batchName: batch.name,
      status: batch.status,
      completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
      totalActive,
      certified,
      eligibleNotIssued,
      inProgress,
      dropped,
      percentComplete,
      assignmentsSubmittedPct,
      assessmentsPassedPct,
      finalProjectApprovedPct,
      canTransitionToComplete: batch.status === "active",
    };
  }

  /** GET /crm/batches/:id/completion/students — paginated, never an unbounded array (Part 4 edge case). */
  async listStudents(
    tenantId: string,
    actorId: string,
    batchId: string,
    query: ListBatchCompletionStudentsQuery,
  ): Promise<PaginatedResult<BatchCompletionStudentRow>> {
    await this.loadScopedBatch(tenantId, actorId, batchId);

    const all = await this.repository.listEnrollments(tenantId, batchId);
    const statusFiltered = query.status ? all.filter((e) => e.status === query.status) : all;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const total = statusFiltered.length;
    const pageRows = statusFiltered.slice((page - 1) * pageSize, page * pageSize);

    const computed = await this.computeRows(tenantId, pageRows);
    // `bucket` is server-computed (not a DB column) — filtered AFTER the page is computed,
    // same accepted limitation as CertificatesService.listEligibility's post-pagination
    // `eligible`/`hasRecommendation` filters (see file header COMPUTE COST NOTE).
    const filtered = query.bucket ? computed.filter((r) => r.bucket === query.bucket) : computed;

    const items: BatchCompletionStudentRow[] = filtered.map((r) => ({
      enrollmentId: r.enrollmentId,
      studentId: r.studentId,
      studentName: r.studentName,
      status: r.status,
      bucket: r.bucket,
      eligibility: r.eligibility,
      certificateStatus: r.certificateStatus,
      certificateId: r.certificateId,
    }));

    return new PaginatedResult(items, {
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    });
  }

  /** POST /crm/batches/:id/complete — AC-38 through AC-45. */
  async markComplete(tenantId: string, actorId: string, batchId: string): Promise<MarkBatchCompleteResponse> {
    const batch = await this.loadScopedBatch(tenantId, actorId, batchId);

    // AC-39: valid ONLY from 'active'.
    if (batch.status === "completed" || batch.status === "archived") {
      throw new ConflictException({
        code: "ALREADY_COMPLETED",
        title: "Batch already completed",
        detail: "This batch has already been marked complete (or archived) — no action taken.",
      });
    }
    if (batch.status !== "active") {
      throw new UnprocessableEntityException({
        code: "BATCH_NOT_ACTIVE",
        title: "Batch is not active",
        detail: "Only a batch with status='active' can be marked complete.",
      });
    }

    const completedAt = new Date();
    // AC-42: pure status/timestamp write — no enrollment/progress/grading/certificate row touched.
    // F2: compare-and-set. If a concurrent mentor completed the batch between the check above and
    // now, this affects 0 rows → surface the same ALREADY_COMPLETED 409 (no double write/audit).
    const affected = await this.repository.markComplete(tenantId, batchId, actorId, completedAt);
    if (affected === 0) {
      throw new ConflictException({
        code: "ALREADY_COMPLETED",
        title: "Batch already completed",
        detail: "This batch was marked complete by another action — no duplicate transition applied.",
      });
    }

    // AC-41/Rule M-2: the rollup is ALWAYS computed and returned for visibility, but never
    // gates the transition above (already committed by this point).
    const summary = await this.getSummary(tenantId, actorId, batchId);

    return {
      batchId: batch.id,
      status: "completed",
      completedAt: completedAt.toISOString(),
      completedByUserId: actorId,
      summary,
    };
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return clampPct(sum / values.length);
}

function percentTrue(values: boolean[]): number {
  if (values.length === 0) return 0;
  const trueCount = values.filter(Boolean).length;
  return clampPct((trueCount / values.length) * 100);
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}
