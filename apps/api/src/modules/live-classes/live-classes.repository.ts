// apps/api/src/modules/live-classes/live-classes.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). LiveClassesService is the only caller. Every
// query is tenant-scoped from the caller's `req.user.tenantId`. Soft-delete + audit are
// handled transparently by the Prisma client extensions (`LiveClass`/`Attendance` are both
// already registered in soft-delete.extension.ts / audit.extension.ts).
//
// SCOPE RESOLUTION (docs/plans/phase-9-completion.md T20, prisma/seed.ts P9 grants):
//   - "all"      -> tenant-wide. super_admin/admin.
//   - "branch"   -> `live_classes.batch.branchId IN (caller's user_roles.branchId values)`.
//                    branch_manager is seeded at this scope for liveclass.view.
//   - "assigned" -> `live_classes.batchId IN (batches taught by this faculty OR assigned to
//                    this mentor via batch_mentors)`. faculty/mentor are seeded at this scope.
//   - "own"      -> `live_classes.batchId IN (batches the student holds an active enrollment
//                    in)`. student is seeded at this scope for view/join.
// Faculty/mentor "assigned" batch-id resolution reuses `EnrollmentScopeRepository` (shared
// helper, CommonScopeModule) rather than duplicating the batches/batch_mentors join here.

import { Injectable } from "@nestjs/common";
import type { Prisma, LiveClassProvider as PrismaLiveClassProvider, LiveClassStatus as PrismaLiveClassStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface LiveClassRow {
  id: string;
  tenantId: string;
  batchId: string;
  batchName: string;
  branchId: string;
  programId: string;
  programTitle: string;
  title: string;
  provider: PrismaLiveClassProvider;
  providerMeetingId: string | null;
  joinUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  status: PrismaLiveClassStatus;
  recordingUrl: string | null;
  hostUserId: string;
  hostName: string;
  attendeeCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ListLiveClassesFilters {
  tenantId: string;
  batchId?: string;
  programId?: string;
  status?: PrismaLiveClassStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
  /** "branch" scope restriction — batch.branchId IN (...). */
  restrictToBranchIds?: string[];
  /** "assigned"/"own" scope restriction — batchId IN (...). Empty array = zero rows (fail-closed). */
  restrictToBatchIds?: string[];
}

const LIVE_CLASS_INCLUDE = {
  batch: { select: { name: true, branchId: true } },
  program: { select: { title: true } },
  hostUser: { select: { name: true } },
  _count: { select: { attendance: { where: { deletedAt: null } } } },
} satisfies Prisma.LiveClassInclude;

type LiveClassWithIncludes = Prisma.LiveClassGetPayload<{ include: typeof LIVE_CLASS_INCLUDE }>;

function toRow(row: LiveClassWithIncludes): LiveClassRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    batchId: row.batchId,
    batchName: row.batch.name,
    branchId: row.batch.branchId,
    programId: row.programId,
    programTitle: row.program.title,
    title: row.title,
    provider: row.provider,
    providerMeetingId: row.providerMeetingId,
    joinUrl: row.joinUrl,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    recordingUrl: row.recordingUrl,
    hostUserId: row.hostUserId,
    hostName: row.hostUser.name,
    attendeeCount: row._count.attendance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class LiveClassesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListLiveClassesFilters): Promise<{ rows: LiveClassRow[]; total: number }> {
    const where: Prisma.LiveClassWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.batchId ? { batchId: filters.batchId } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            startsAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.restrictToBranchIds ? { batch: { branchId: { in: filters.restrictToBranchIds } } } : {}),
      ...(filters.restrictToBatchIds ? { batchId: { in: filters.restrictToBatchIds } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.liveClass.findMany({
        where,
        include: LIVE_CLASS_INCLUDE,
        orderBy: { startsAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.liveClass.count({ where }),
    ]);

    return { rows: rows.map(toRow), total };
  }

  async findById(tenantId: string, id: string): Promise<LiveClassRow | null> {
    const row = await this.prisma.client.liveClass.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: LIVE_CLASS_INCLUDE,
    });
    return row ? toRow(row) : null;
  }

  /** Tenant-agnostic-by-design lookup for the webhook path (provider payload carries no tenantId). */
  async findByProviderMeetingId(providerMeetingId: string): Promise<LiveClassRow | null> {
    const row = await this.prisma.client.liveClass.findFirst({
      where: { providerMeetingId, deletedAt: null },
      include: LIVE_CLASS_INCLUDE,
    });
    return row ? toRow(row) : null;
  }

  async create(
    tenantId: string,
    data: {
      batchId: string;
      programId: string;
      title: string;
      provider: PrismaLiveClassProvider;
      providerMeetingId: string | null;
      joinUrl: string | null;
      startsAt: Date;
      endsAt: Date;
      hostUserId: string;
    },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.liveClass.create({
      data: {
        tenantId,
        batchId: data.batchId,
        programId: data.programId,
        title: data.title,
        provider: data.provider,
        providerMeetingId: data.providerMeetingId,
        joinUrl: data.joinUrl,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        hostUserId: data.hostUserId,
      },
    });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{
      title: string;
      startsAt: Date;
      endsAt: Date;
      hostUserId: string;
      status: PrismaLiveClassStatus;
      recordingUrl: string | null;
      joinUrl: string | null;
      providerMeetingId: string | null;
    }>,
  ): Promise<void> {
    await this.prisma.client.liveClass.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.liveClass.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  // ── Org lookups for scope resolution (mirrors batches.repository.ts precedent) ─────

  /** Branch ids the caller's `user_roles` rows are scoped to (non-null `branchId` entries only). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }

  /** The caller's own faculty_profiles row id, used to resolve "assigned" scope (mirrors batches.repository.ts). */
  async findOwnFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Verifies a batch exists (in-tenant), returning its programId + branchId for create(). */
  async findBatchForCreate(tenantId: string, batchId: string): Promise<{ id: string; programId: string; branchId: string } | null> {
    const row = await this.prisma.client.batch.findFirst({
      where: { id: batchId, tenantId, deletedAt: null },
      select: { id: true, programId: true, branchId: true },
    });
    return row;
  }

  /** Verifies the hostUserId belongs to an active, in-tenant user. */
  async userExists(tenantId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.client.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true },
    });
    return !!row;
  }

  /** Host's display name + email, for the reminder recipient list and provider calls. */
  async findUserContact(tenantId: string, userId: string): Promise<{ name: string; email: string } | null> {
    const row = await this.prisma.client.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { name: true, email: true },
    });
    return row;
  }

  /**
   * Recipient list for a batch's live-class reminders: every actively-enrolled student's
   * (userId, email) pair. Used by LiveClassesService.scheduleReminders — the host is added
   * separately by the service (host is not necessarily "enrolled").
   */
  async listBatchStudentRecipients(tenantId: string, batchId: string): Promise<Array<{ userId: string; email: string }>> {
    const rows = await this.prisma.client.enrollment.findMany({
      where: { tenantId, batchId, deletedAt: null, status: "active", student: { deletedAt: null } },
      select: { student: { select: { user: { select: { id: true, email: true } } } } },
    });
    return rows.map((row) => ({ userId: row.student.user.id, email: row.student.user.email }));
  }

  // ── Attendance auto-sync (T20: writes attendance.live_class_id within <=60s of join) ──

  /** Resolves the (enrollmentId) for a student joining a given batch's live session, by userId. */
  async findActiveEnrollmentForBatch(
    tenantId: string,
    batchId: string,
    userId: string,
  ): Promise<{ enrollmentId: string } | null> {
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!student) return null;
    const enrollment = await this.prisma.client.enrollment.findFirst({
      where: { tenantId, studentId: student.id, batchId, deletedAt: null },
      select: { id: true },
    });
    return enrollment ? { enrollmentId: enrollment.id } : null;
  }

  /** Resolves an enrollment by (batchId, student email) — used by the webhook's participant-join sync path. */
  async findActiveEnrollmentForBatchByEmail(
    tenantId: string,
    batchId: string,
    email: string,
  ): Promise<{ enrollmentId: string } | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { tenantId, email, deletedAt: null },
      select: { id: true },
    });
    if (!user) return null;
    return this.findActiveEnrollmentForBatch(tenantId, batchId, user.id);
  }

  /**
   * Idempotent attendance write for a live-class join: one row per
   * (enrollment_id, live_class_id), source='live', status='present'. No partial-unique
   * index exists at the DB level for this pair (see schema.prisma comment on `Attendance`)
   * — dedup is enforced here via a check-then-create, mirroring
   * `LmsRepository.upsertRecordedAttendance`'s identical idempotency pattern.
   */
  async upsertLiveAttendance(args: {
    tenantId: string;
    enrollmentId: string;
    liveClassId: string;
    markedAt: Date;
  }): Promise<{ created: boolean }> {
    const existing = await this.prisma.client.attendance.findFirst({
      where: { enrollmentId: args.enrollmentId, liveClassId: args.liveClassId, source: "live" },
      select: { id: true },
    });
    if (existing) {
      return { created: false };
    }
    try {
      await this.prisma.client.attendance.create({
        data: {
          tenantId: args.tenantId,
          enrollmentId: args.enrollmentId,
          liveClassId: args.liveClassId,
          status: "present",
          source: "live",
          markedAt: args.markedAt,
        },
      });
      return { created: true };
    } catch (err: unknown) {
      // Concurrent join race — treat as idempotent no-op (same pattern as
      // lms.repository.ts's upsertRecordedAttendance P2002 handling).
      const isPrismaUniqueViolation =
        typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
      if (isPrismaUniqueViolation) {
        return { created: false };
      }
      throw err;
    }
  }
}
