// apps/api/src/modules/enrollments/enrollments.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). EnrollmentsService is the
// only caller. Every query is tenant-scoped from the caller's `req.user.tenantId`.
//
// SCOPE RESOLUTION (docs/03 §9 + prisma/seed.ts):
//   - "all"      -> tenant-wide. super_admin/admin.
//   - "branch"   -> `enrollments.batch.branchId IN (caller's user_roles.branchId values)`.
//                    branch_manager is seeded at this scope for enrollments.view/create/edit.
//                    Resolved via a join to `batches` (enrollments has no direct branchId
//                    column) — see `restrictToBranchIds` below.
//   - "assigned" -> `enrollments.batch.facultyId = caller's faculty_profiles.id`. faculty is
//                    seeded at this scope for enrollments.view/edit. Resolved via the same
//                    join.
//   - "own"      -> not seeded for the enrollments module in P1; not implemented here.
//
// UNIQUE-CONSTRAINT / RE-ENROLLMENT CONTRACT (critical, see EnrollmentsService.enroll()):
// `@@unique([studentId, batchId])` on `enrollments` is a FULL-COLUMN unique — it has no
// partial/filtered-index carve-out for soft-deleted rows. A student withdrawn (soft-deleted)
// from a batch and re-enrolled into the SAME batch must hard-RESTORE the existing row
// (`deletedAt = null`, `status = active`), never INSERT a second row, or the insert will
// violate the unique index. `findExisting()` below deliberately reads through soft-delete
// (includeDeleted=true) so the service can detect this case before deciding create-vs-restore.

import { Injectable } from "@nestjs/common";
import type { EnrollmentStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListEnrollmentsFilters {
  tenantId: string;
  studentId?: string;
  batchId?: string;
  programId?: string;
  status?: EnrollmentStatus;
  page: number;
  pageSize: number;
  /** "branch"/"assigned" scope: restrict to enrollments whose batch matches these ids. */
  restrictToBatchIds?: string[];
}

export interface EnrollmentRow {
  id: string;
  studentId: string;
  studentName: string;
  batchId: string;
  batchName: string;
  programId: string;
  programTitle: string;
  status: EnrollmentStatus;
  progressPct: number;
  enrolledAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}

const ENROLLMENT_INCLUDE = {
  student: { include: { user: { select: { name: true } } } },
  batch: { select: { name: true, branchId: true, facultyId: true } },
  program: { select: { title: true } },
} as const;

type EnrollmentWithIncludes = {
  id: string;
  studentId: string;
  batchId: string;
  programId: string;
  status: EnrollmentStatus;
  progressPct: number;
  enrolledAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
  student: { user: { name: string } };
  batch: { name: string; branchId: string; facultyId: string | null };
  program: { title: string };
};

function toEnrollmentRow(row: EnrollmentWithIncludes): EnrollmentRow {
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: row.student.user.name,
    batchId: row.batchId,
    batchName: row.batch.name,
    programId: row.programId,
    programTitle: row.program.title,
    status: row.status,
    progressPct: row.progressPct,
    enrolledAt: row.enrolledAt,
    completedAt: row.completedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class EnrollmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListEnrollmentsFilters): Promise<{ rows: EnrollmentRow[]; total: number }> {
    const where = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.batchId ? { batchId: filters.batchId } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.restrictToBatchIds ? { batchId: { in: filters.restrictToBatchIds } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.enrollment.findMany({
        where,
        include: ENROLLMENT_INCLUDE,
        orderBy: { enrolledAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.enrollment.count({ where }),
    ]);

    return { rows: rows.map(toEnrollmentRow), total };
  }

  async findById(tenantId: string, id: string, includeDeleted = false): Promise<EnrollmentRow | null> {
    // NOTE: the soft-delete extension (soft-delete.extension.ts `withNotDeleted`) injects
    // `deletedAt: null` into any `where` that does NOT already have a `deletedAt` KEY —
    // an absent key, not merely a falsy/undefined value, triggers the injection. So
    // `includeDeleted` must explicitly set `deletedAt: undefined` (a present key) to opt
    // out — this is exactly the create-vs-restore detection path this file's header
    // comment describes, so it must actually be able to see soft-deleted rows.
    const row = await this.prisma.client.enrollment.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null },
      include: ENROLLMENT_INCLUDE,
    });
    return row ? toEnrollmentRow(row) : null;
  }

  /**
   * Finds an existing (studentId, batchId) row REGARDLESS of soft-delete state — the
   * lookup the unique-constraint / re-enrollment contract (see file header) depends on to
   * decide create-vs-restore before ever calling `create()`.
   */
  async findExisting(tenantId: string, studentId: string, batchId: string): Promise<EnrollmentRow | null> {
    const row = await this.prisma.client.enrollment.findFirst({
      where: { tenantId, studentId, batchId },
      include: ENROLLMENT_INCLUDE,
    });
    return row ? toEnrollmentRow(row) : null;
  }

  async create(tenantId: string, data: { studentId: string; batchId: string; programId: string }): Promise<{ id: string }> {
    const row = await this.prisma.client.enrollment.create({
      data: {
        tenantId,
        studentId: data.studentId,
        batchId: data.batchId,
        programId: data.programId,
        status: "active",
        progressPct: 0,
      },
    });
    return { id: row.id };
  }

  /** Hard-restores a previously soft-deleted row (see file header re-enrollment contract). */
  async restoreAsActive(id: string): Promise<void> {
    await this.prisma.client.enrollment.update({
      where: { id },
      data: { deletedAt: null, status: "active", progressPct: 0, completedAt: null },
    });
  }

  /**
   * Atomic enroll-or-restore (see file header re-enrollment contract). Re-checks the
   * (studentId, batchId) row INSIDE the transaction (not just relying on the service's
   * earlier `findExisting()` read) so a concurrent enroll for the same pair cannot race
   * past the unique constraint between the check and the write — `tx.enrollment.create`
   * here would still throw a unique-violation under a true race, which the service layer
   * surfaces as a 409, but the common soft-deleted-row-restore path is made race-safe by
   * re-reading inside the same transaction.
   */
  async enrollOrRestore(
    tenantId: string,
    data: { studentId: string; batchId: string; programId: string },
  ): Promise<{ id: string; restored: boolean }> {
    return this.prisma.client.$transaction(async (tx) => {
      // Must see a SOFT-DELETED row here too (re-enrollment/hard-restore contract, see
      // file header) — `deletedAt: undefined` (a present key) is required to opt out of
      // the soft-delete extension's auto-injected `deletedAt: null` filter, exactly like
      // findExisting()/findById() above. Without it this `findFirst` would never find the
      // withdrawn row, fall through to `create()`, and violate the
      // `@@unique([studentId, batchId])` constraint — which is exactly the 500 this
      // method exists to prevent.
      const existing = await tx.enrollment.findFirst({
        where: { tenantId, studentId: data.studentId, batchId: data.batchId, deletedAt: undefined },
        select: { id: true },
      });

      // An enrolled student is no longer an "admissions" record: promote the
      // coarse profile status lead → active in the same transaction. (Self-
      // registered students start active; converted-lead students started as
      // "lead" and previously stayed there forever, so a paying, enrolled
      // student still sat in the directory's Admissions bucket.)
      const promoteProfile = () =>
        tx.studentProfile.updateMany({
          where: { id: data.studentId, tenantId, status: "lead" },
          data: { status: "active" },
        });

      if (existing) {
        await tx.enrollment.update({
          where: { id: existing.id },
          data: { deletedAt: null, status: "active", progressPct: 0, completedAt: null, programId: data.programId },
        });
        await promoteProfile();
        return { id: existing.id, restored: true };
      }

      const row = await tx.enrollment.create({
        data: {
          tenantId,
          studentId: data.studentId,
          batchId: data.batchId,
          programId: data.programId,
          status: "active",
          progressPct: 0,
        },
      });
      await promoteProfile();
      return { id: row.id, restored: false };
    });
  }

  async updateBatch(id: string, batchId: string, programId: string): Promise<void> {
    await this.prisma.client.enrollment.update({
      where: { id },
      data: { batchId, programId },
    });
  }

  async updateStatus(id: string, status: EnrollmentStatus, completedAt?: Date | null): Promise<void> {
    await this.prisma.client.enrollment.update({
      where: { id },
      data: { status, ...(completedAt !== undefined ? { completedAt } : {}) },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.enrollment.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  /** Branch ids the caller's `user_roles` rows are scoped to (non-null `branchId` entries only). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }

  /** The caller's own faculty_profiles row id, used to resolve "assigned" scope. */
  async findOwnFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Batch ids in the given branch ids — used to resolve "branch" scope's enrollments filter. */
  async listBatchIdsForBranches(tenantId: string, branchIds: string[]): Promise<string[]> {
    if (branchIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, branchId: { in: branchIds }, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Batch ids taught by the given faculty profile — used to resolve "assigned" scope's enrollments filter. */
  async listBatchIdsForFaculty(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, facultyId: facultyProfileId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Verifies a student profile exists (and is in-tenant). */
  async studentExists(tenantId: string, studentId: string): Promise<boolean> {
    const row = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: { id: true },
    });
    return !!row;
  }

  /**
   * True when the student holds at least one PAID order for the given program in this
   * tenant — the ENTITLEMENT precondition for a manual batch enrollment. Business rule
   * (integrity): a student may only be placed into a batch whose program they have paid
   * for; the commerce checkout (online Razorpay OR an offline `Payment.isManual` capture
   * against an order) is the only way to create that paid order. Without this, the manual
   * roster/enroll path silently bypassed payment (see EnrollmentsService.enroll()).
   */
  async hasPaidOrderForProgram(tenantId: string, studentId: string, programId: string): Promise<boolean> {
    const row = await this.prisma.client.order.findFirst({
      where: { tenantId, studentId, programId, status: "paid", deletedAt: null },
      select: { id: true },
    });
    return !!row;
  }

  /** Returns the batch's programId/branchId/facultyId/capacity (and current active+completed enrollment count) for validation. */
  async findBatchForEnrollment(
    tenantId: string,
    batchId: string,
  ): Promise<{ id: string; programId: string; branchId: string; facultyId: string | null; capacity: number } | null> {
    const row = await this.prisma.client.batch.findFirst({
      where: { id: batchId, tenantId, deletedAt: null },
      select: { id: true, programId: true, branchId: true, facultyId: true, capacity: true },
    });
    return row;
  }

  async countActiveEnrollments(batchId: string): Promise<number> {
    return this.prisma.client.enrollment.count({
      where: { batchId, status: { in: ["active", "completed"] }, deletedAt: null },
    });
  }

  // ── lifecycle-redesign P4: batch auto-spill ────────────────────────────────

  /**
   * The full config of a batch used as the TEMPLATE when auto-creating its spillover
   * sibling (clone capacity/mode/schedule/faculty/branch, derive a fresh name + start).
   */
  async findBatchTemplate(
    tenantId: string,
    batchId: string,
  ): Promise<BatchTemplate | null> {
    return this.prisma.client.batch.findFirst({
      where: { id: batchId, tenantId, deletedAt: null },
      select: {
        id: true,
        programId: true,
        branchId: true,
        facultyId: true,
        capacity: true,
        mode: true,
        schedule: true,
        name: true,
        startDate: true,
        endDate: true,
      },
    });
  }

  /**
   * Candidate spillover siblings: non-deleted, not-yet-completed/archived batches of the
   * SAME program+branch (excluding the full source batch), ordered by soonest start so
   * the student lands in the next cohort. The service then picks the first one that still
   * has room (a capacity check per candidate — the set is small). Returns id + capacity +
   * live active/completed enrollment count so the caller avoids N extra count queries.
   */
  async listSiblingBatchesWithLoad(
    tenantId: string,
    programId: string,
    branchId: string,
    excludeBatchId: string,
  ): Promise<Array<{ id: string; capacity: number; load: number }>> {
    const rows = await this.prisma.client.batch.findMany({
      where: {
        tenantId,
        programId,
        branchId,
        deletedAt: null,
        status: { in: ["planned", "active"] },
        id: { not: excludeBatchId },
      },
      select: {
        id: true,
        capacity: true,
        _count: { select: { enrollments: { where: { status: { in: ["active", "completed"] }, deletedAt: null } } } },
      },
      orderBy: { startDate: "asc" },
    });
    return rows.map((r) => ({ id: r.id, capacity: r.capacity, load: r._count.enrollments }));
  }

  /**
   * How many sibling batches (same program+branch, including soft-deleted) already exist —
   * used only to derive a stable, non-colliding "Section N" name for the new batch.
   */
  async countSiblingBatches(tenantId: string, programId: string, branchId: string): Promise<number> {
    return this.prisma.client.batch.count({ where: { tenantId, programId, branchId } });
  }

  /** Creates the spillover batch by cloning the template's config (P4 auto-spill). */
  async createSpilloverBatch(
    tenantId: string,
    template: BatchTemplate,
    name: string,
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.batch.create({
      data: {
        tenantId,
        programId: template.programId,
        branchId: template.branchId,
        facultyId: template.facultyId,
        name,
        startDate: template.startDate,
        endDate: template.endDate,
        capacity: template.capacity,
        mode: template.mode,
        schedule: template.schedule ?? undefined,
        status: "planned",
      },
      select: { id: true },
    });
    return row;
  }
}

/** Template shape cloned when auto-creating a spillover batch (P4). */
export interface BatchTemplate {
  id: string;
  programId: string;
  branchId: string;
  facultyId: string | null;
  capacity: number;
  mode: import("@prisma/client").ProgramMode;
  schedule: import("@prisma/client").Prisma.JsonValue | null;
  name: string;
  startDate: Date;
  endDate: Date | null;
}
