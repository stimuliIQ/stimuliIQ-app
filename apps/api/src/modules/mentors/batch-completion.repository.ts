// apps/api/src/modules/mentors/batch-completion.repository.ts
//
// Prisma data access ONLY for the internship-completion rollup (WS-3, docs/specs/
// phase-8-mentor.md, LOCK-4/AC-31). Reads `enrollments`/`certificates`/`assignments`/
// `submissions` directly and writes the `active -> completed` transition on `batches` —
// deliberately NOT importing BatchesRepository (see batch-mentors.repository.ts file
// header for the same "bounded module" rationale). Per-student eligibility itself is
// computed by `CertificatesService.isEligible` (P4 eligibility engine, reused verbatim,
// never reimplemented here) — this repository only supplies the raw counts/rows that
// engine and the batch-level aggregates need.

import { Injectable } from "@nestjs/common";
import type { BatchStatus, EnrollmentStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface CompletionBatchRow {
  id: string;
  tenantId: string;
  branchId: string;
  programId: string;
  name: string;
  status: BatchStatus;
  completedAt: Date | null;
}

export interface CompletionEnrollmentRow {
  id: string;
  studentId: string;
  studentName: string;
  status: EnrollmentStatus;
  progressPct: number;
}

export interface EnrollmentCertificateInfo {
  id: string;
  status: string;
}

@Injectable()
export class BatchCompletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBatchRow(tenantId: string, batchId: string): Promise<CompletionBatchRow | null> {
    const row = await this.prisma.client.batch.findFirst({
      where: { id: batchId, tenantId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        programId: true,
        name: true,
        status: true,
        completedAt: true,
      },
    });
    return row;
  }

  /** Branch ids the caller's `user_roles` rows are scoped to (mirrors BatchesRepository.listCallerBranchIds). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }

  /** Every non-deleted enrollment in the batch, any status — AC-34/36: a zero-enrollment batch is a valid empty result. */
  async listEnrollments(tenantId: string, batchId: string): Promise<CompletionEnrollmentRow[]> {
    const rows = await this.prisma.client.enrollment.findMany({
      where: { tenantId, batchId, deletedAt: null },
      include: { student: { include: { user: { select: { name: true } } } } },
      orderBy: { enrolledAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      studentId: row.studentId,
      studentName: row.student.user.name,
      status: row.status,
      progressPct: row.progressPct,
    }));
  }

  /** Current (any-status) certificate row per enrollment — at most one active row per the partial-unique index. */
  async findCertificatesForEnrollments(
    tenantId: string,
    enrollmentIds: string[],
  ): Promise<Map<string, EnrollmentCertificateInfo>> {
    if (enrollmentIds.length === 0) return new Map();
    const rows = await this.prisma.client.certificate.findMany({
      where: { tenantId, enrollmentId: { in: enrollmentIds }, deletedAt: null },
      select: { id: true, enrollmentId: true, status: true },
    });
    return new Map(rows.map((row) => [row.enrollmentId, { id: row.id, status: row.status }]));
  }

  /** Program's non-project (kind='assignment') assignment count — denominator for assignmentsSubmittedPct. */
  async countNonProjectAssignments(tenantId: string, programId: string): Promise<number> {
    const modules = await this.prisma.client.module.findMany({
      where: { programId, deletedAt: null },
      select: { id: true },
    });
    const moduleIds = modules.map((m) => m.id);
    if (moduleIds.length === 0) return 0;

    const lessons = await this.prisma.client.lesson.findMany({
      where: { moduleId: { in: moduleIds }, deletedAt: null },
      select: { id: true },
    });
    const lessonIds = lessons.map((l) => l.id);
    if (lessonIds.length === 0) return 0;

    return this.prisma.client.assignment.count({
      where: { tenantId, lessonId: { in: lessonIds }, kind: "assignment", deletedAt: null },
    });
  }

  /** Non-project assignment ids for the program (used to scope the distinct-submission count). */
  async listNonProjectAssignmentIds(tenantId: string, programId: string): Promise<string[]> {
    const modules = await this.prisma.client.module.findMany({
      where: { programId, deletedAt: null },
      select: { id: true },
    });
    const moduleIds = modules.map((m) => m.id);
    if (moduleIds.length === 0) return [];

    const lessons = await this.prisma.client.lesson.findMany({
      where: { moduleId: { in: moduleIds }, deletedAt: null },
      select: { id: true },
    });
    const lessonIds = lessons.map((l) => l.id);
    if (lessonIds.length === 0) return [];

    const assignments = await this.prisma.client.assignment.findMany({
      where: { tenantId, lessonId: { in: lessonIds }, kind: "assignment", deletedAt: null },
      select: { id: true },
    });
    return assignments.map((a) => a.id);
  }

  /** Distinct (enrollmentId, assignmentId) pairs with at least one (non-deleted) submission — "has a submission". */
  async countDistinctSubmittedPairs(
    tenantId: string,
    enrollmentIds: string[],
    assignmentIds: string[],
  ): Promise<number> {
    if (enrollmentIds.length === 0 || assignmentIds.length === 0) return 0;
    const rows = await this.prisma.client.submission.findMany({
      where: {
        tenantId,
        enrollmentId: { in: enrollmentIds },
        assignmentId: { in: assignmentIds },
        deletedAt: null,
      },
      select: { enrollmentId: true, assignmentId: true },
      distinct: ["enrollmentId", "assignmentId"],
    });
    return rows.length;
  }

  /**
   * AC-40/AC-42: pure `status`/`completed_at`/`completed_by_user_id` write — no other table touched.
   * Race-safe compare-and-set (F2) that STILL audits (the audit extension only captures single
   * `update`, not `updateMany`): a row-level `SELECT ... FOR UPDATE` serializes concurrent
   * completers, so only the ONE caller that locks the row while it's still `active` performs the
   * transition — the second blocks, re-reads `completed`, and gets 0 back → the service surfaces
   * ALREADY_COMPLETED. No double `completed_at` overwrite, no double audit row. tenantId is in the
   * predicate as defense-in-depth (F6), never trusting the prior scoped read alone. Returns the
   * affected-row count (1 = we won, 0 = someone else already completed it).
   */
  async markComplete(
    tenantId: string,
    batchId: string,
    completedByUserId: string,
    completedAt: Date,
  ): Promise<number> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM batches
        WHERE id = ${batchId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE`;
      if (locked.length === 0 || locked[0]?.status !== "active") return 0;

      // Single `update` → captured by the Prisma audit extension (which applies to the tx client).
      await tx.batch.update({
        where: { id: batchId },
        data: { status: "completed", completedAt, completedByUserId },
      });
      return 1;
    });
  }
}
