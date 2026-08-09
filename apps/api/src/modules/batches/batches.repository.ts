// apps/api/src/modules/batches/batches.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). BatchesService is the only
// caller. Every query is tenant-scoped from the caller's `req.user.tenantId`.
//
// SCOPE RESOLUTION (docs/03 §9 + prisma/seed.ts):
//   - "all"      -> tenant-wide. super_admin/admin.
//   - "branch"   -> `batches.branchId IN (caller's user_roles.branchId values)`.
//                    branch_manager is seeded at this scope for batches.*. `branchId` is a
//                    direct, required column on `Batch` — fully resolvable, no Wave-3b gap.
//   - "assigned" -> `batches.facultyId = caller's faculty_profiles.id`. faculty is seeded
//                    at this scope for batches.view/edit. Fully resolvable: `facultyId` is
//                    a direct column.
//   - "own"      -> not seeded for the batches module in P1; not implemented here (the
//                    service fails closed defensively if ever encountered).

import { Injectable } from "@nestjs/common";
import type { Prisma, BatchStatus, ProgramMode } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { OPEN_BATCH_STATUSES, startOfTodayUtc } from "./lib/batch-expiry";

export interface ListBatchesFilters {
  tenantId: string;
  search?: string;
  programId?: string;
  branchId?: string;
  facultyId?: string;
  status?: BatchStatus;
  /** Only batches a student can still be enrolled into — see ListBatchesQuerySchema.enrollable. */
  enrollable?: boolean;
  includeDeleted: boolean;
  page: number;
  pageSize: number;
  /** Batch ids to additionally restrict to, when the caller's scope narrows the result set. */
  restrictToIds?: string[];
  /** "branch" scope: restrict to batches whose `branchId` is in this list (combined via AND with `branchId` filter if both present). */
  restrictToBranchIds?: string[];
}

export interface BatchRow {
  id: string;
  programId: string;
  programTitle: string;
  branchId: string;
  branchName: string;
  facultyId: string | null;
  facultyName: string | null;
  name: string;
  startDate: Date;
  endDate: Date | null;
  capacity: number;
  enrolledCount: number;
  mode: ProgramMode;
  schedule: unknown;
  status: BatchStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BatchRosterRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  status: string;
  progressPct: number;
  enrolledAt: Date;
}

const BATCH_INCLUDE = {
  program: { select: { title: true } },
  branch: { select: { name: true } },
  faculty: { select: { id: true, user: { select: { name: true } } } },
  enrollments: {
    where: { status: { in: ["active", "completed"] }, deletedAt: null },
    select: { id: true },
  },
} satisfies Prisma.BatchInclude;

type BatchWithIncludes = Prisma.BatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

function toBatchRow(row: BatchWithIncludes): BatchRow {
  return {
    id: row.id,
    programId: row.programId,
    programTitle: row.program.title,
    branchId: row.branchId,
    branchName: row.branch.name,
    facultyId: row.faculty?.id ?? null,
    facultyName: row.faculty?.user.name ?? null,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    capacity: row.capacity,
    enrolledCount: row.enrollments.length,
    mode: row.mode,
    schedule: row.schedule,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class BatchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListBatchesFilters): Promise<{ rows: BatchRow[]; total: number }> {
    // Constraints that must INTERSECT rather than overwrite each other. Spreading two
    // conditions on the same column into one object silently keeps only the last, so
    // anything that can collide goes in this AND list instead.
    //
    // `branchId` (from the query string) and `restrictToBranchIds` (from the caller's
    // scope) both target branch_id — without this, a "branch"-scoped caller could pass a
    // `branchId` outside their scope and Prisma would honour only the last-spread key.
    // `enrollable` likewise constrains `status`, which the explicit `status` filter also
    // sets below.
    const andConstraints: Prisma.BatchWhereInput[] = [];
    if (filters.branchId) {
      andConstraints.push({ branchId: filters.branchId });
    }
    if (filters.restrictToBranchIds) {
      andConstraints.push({ branchId: { in: filters.restrictToBranchIds } });
    }

    // `enrollable`: an OPEN status and not past its end date (see
    // ListBatchesQuerySchema.enrollable for why both halves are needed).
    if (filters.enrollable) {
      andConstraints.push({ status: { in: [...OPEN_BATCH_STATUSES] } });
      // An open-ended batch (endDate null) never expires.
      andConstraints.push({ OR: [{ endDate: null }, { endDate: { gte: startOfTodayUtc() } }] });
    }

    const where: Prisma.BatchWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.facultyId ? { facultyId: filters.facultyId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      // The soft-delete extension re-injects `deletedAt: null` for any `where` missing
      // the `deletedAt` KEY entirely — `deletedAt: undefined` (a present key) is required
      // to actually opt out when `includeDeleted` is true (see findById() below).
      deletedAt: filters.includeDeleted ? undefined : null,
      ...(filters.restrictToIds ? { id: { in: filters.restrictToIds } } : {}),
      ...(andConstraints.length > 0 ? { AND: andConstraints } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.batch.findMany({
        where,
        include: BATCH_INCLUDE,
        orderBy: { startDate: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.batch.count({ where }),
    ]);

    return { rows: rows.map(toBatchRow), total };
  }

  async findById(tenantId: string, id: string, includeDeleted = false): Promise<BatchRow | null> {
    // See the `list()` comment above: `deletedAt: undefined` (a present key) is required
    // to opt out of the soft-delete extension's auto-injected filter.
    const row = await this.prisma.client.batch.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null },
      include: BATCH_INCLUDE,
    });
    return row ? toBatchRow(row) : null;
  }

  /** Branch ids the caller's `user_roles` rows are scoped to (non-null `branchId` entries only). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }

  /**
   * Every still-open batch whose end date has passed, across ALL tenants.
   *
   * Tenant-unscoped by design — the only caller is BatchAutoCloseScheduler, a system
   * sweep with no request user to scope by. Every other method on this repository is
   * scoped from `req.user.tenantId`; this one must never be reachable from a controller.
   * `tenantId` is selected so the audit rows it produces land in the right tenant.
   */
  findExpiredOpenBatches(now: Date = new Date()): Promise<Array<{ id: string; tenantId: string; name: string; status: BatchStatus }>> {
    return this.prisma.client.batch.findMany({
      where: {
        status: { in: [...OPEN_BATCH_STATUSES] },
        endDate: { not: null, lt: startOfTodayUtc(now) },
        deletedAt: null,
      },
      select: { id: true, tenantId: true, name: true, status: true },
    });
  }

  /**
   * Flips ONE expired batch to `completed`. Returns false if it no longer qualified.
   *
   * Compare-and-set on the status (`status: { in: OPEN }` in the where): if a human
   * completed or archived the batch between the sweep's read and this write, the update
   * matches 0 rows and we skip it — no clobbering someone's explicit action, and no
   * audit row for a transition that did not happen. Mirrors the same guard
   * BatchCompletionService.markComplete() uses for concurrent completion.
   *
   * `completedByUserId` stays null: nobody did this, the calendar did. That is what
   * distinguishes an auto-close from a human completion in the audit trail.
   */
  async markExpiredComplete(batchId: string, completedAt: Date): Promise<boolean> {
    const { count } = await this.prisma.client.batch.updateMany({
      where: { id: batchId, status: { in: [...OPEN_BATCH_STATUSES] }, deletedAt: null },
      data: { status: "completed", completedAt },
    });
    return count > 0;
  }

  /** Audit row for a system-initiated close (actorId null — see markExpiredComplete). */
  async recordAutoCloseAudit(args: { tenantId: string; batchId: string; previousStatus: BatchStatus }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: args.tenantId,
        actorId: null,
        entity: "Batch",
        entityId: args.batchId,
        action: "batch.auto_closed",
        before: { status: args.previousStatus },
        after: { status: "completed", reason: "end_date_passed" },
        ip: null,
      },
    });
  }

  /** The caller's own faculty_profiles row id, used to resolve "assigned" scope. */
  async findOwnFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Verifies a program exists (and is in-tenant) — used to validate `programId` on create/update. */
  async programExists(tenantId: string, programId: string): Promise<boolean> {
    const program = await this.prisma.client.program.findFirst({
      where: { id: programId, tenantId, deletedAt: null },
      select: { id: true },
    });
    return !!program;
  }

  /** Verifies a branch exists (and is in-tenant) — used to validate `branchId` on create/update. */
  async branchExists(tenantId: string, branchId: string): Promise<boolean> {
    const branch = await this.prisma.client.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    return !!branch;
  }

  /** Verifies a faculty profile exists (and is in-tenant) — used to validate `facultyId` on create/update/assign. */
  async facultyExists(tenantId: string, facultyId: string): Promise<{ id: string; branchId: string | null } | null> {
    return this.prisma.client.facultyProfile.findFirst({
      where: { id: facultyId, tenantId, deletedAt: null },
      select: { id: true, branchId: true },
    });
  }

  async create(
    tenantId: string,
    data: {
      programId: string;
      branchId: string;
      facultyId?: string | null;
      name: string;
      startDate: Date;
      endDate: Date | null;
      capacity: number;
      mode: ProgramMode;
      schedule: unknown;
      status: BatchStatus;
    },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.batch.create({
      data: {
        tenantId,
        programId: data.programId,
        branchId: data.branchId,
        facultyId: data.facultyId ?? null,
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        capacity: data.capacity,
        mode: data.mode,
        schedule: data.schedule as Prisma.InputJsonValue,
        status: data.status,
      },
    });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{
      programId: string;
      branchId: string;
      facultyId: string | null;
      name: string;
      startDate: Date;
      endDate: Date | null;
      capacity: number;
      mode: ProgramMode;
      schedule: unknown;
      status: BatchStatus;
    }>,
  ): Promise<void> {
    const { schedule, ...rest } = patch;
    await this.prisma.client.batch.update({
      where: { id },
      data: {
        ...rest,
        ...(schedule !== undefined ? { schedule: schedule as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async assignFaculty(id: string, facultyId: string | null): Promise<void> {
    await this.prisma.client.batch.update({ where: { id }, data: { facultyId } });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.batch.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async restore(id: string): Promise<void> {
    await this.prisma.client.batch.update({ where: { id }, data: { deletedAt: null } });
  }

  /** Current active+completed enrollment count — used for capacity checks on enroll/move. */
  async countActiveEnrollments(batchId: string): Promise<number> {
    return this.prisma.client.enrollment.count({
      where: { batchId, status: { in: ["active", "completed"] }, deletedAt: null },
    });
  }

  async roster(batchId: string): Promise<BatchRosterRow[]> {
    const rows = await this.prisma.client.enrollment.findMany({
      where: { batchId, status: { in: ["active", "completed"] }, deletedAt: null },
      include: { student: { include: { user: { select: { name: true, email: true } } } } },
      orderBy: { enrolledAt: "asc" },
    });

    return rows.map((row) => ({
      enrollmentId: row.id,
      studentId: row.studentId,
      studentName: row.student.user.name,
      studentEmail: row.student.user.email,
      status: row.status,
      progressPct: row.progressPct,
      enrolledAt: row.enrolledAt,
    }));
  }
}
