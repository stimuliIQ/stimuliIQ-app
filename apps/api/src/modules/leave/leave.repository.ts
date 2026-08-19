// apps/api/src/modules/leave/leave.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). Covers all five leave tables, because the
// configuration (types, allowances, holidays, the working week) is read on almost every
// request path — you cannot measure a leave request without the holiday list — so splitting
// them across repositories would buy nothing but extra hops.
//
// Soft-delete and audit are handled transparently by the Prisma client extensions: all five
// models are registered in SOFT_DELETE_MODELS and AUDITED_MODELS, so `.delete()` here writes
// `deleted_at`, every read auto-filters, and every mutation lands in `audit_logs` without a
// single explicit log call. The explicit `deletedAt: null` filters below are belt-and-braces
// and make the intent readable at the call site.
//
// DATES: `start_date`, `end_date` and `holidays.date` are Postgres DATE columns. Prisma hands
// them back as UTC-midnight `Date` objects, and they must reach the DTO layer as
// "YYYY-MM-DD" strings — never as a raw Date. A raw Date crosses the envelope as
// "2026-01-05T00:00:00.000Z", and a browser west of UTC renders that as the 4th. Conversion
// happens once, in leave.util.ts.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  LeaveDayPart as PrismaLeaveDayPart,
  LeaveRequestStatus as PrismaLeaveRequestStatus,
} from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";

export interface LeaveTypeRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  paid: boolean;
  allowHalfDay: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HolidayRow {
  id: string;
  date: Date;
  name: string;
  description: string | null;
  optional: boolean;
}

export interface LeaveQuotaRow {
  id: string;
  leaveTypeId: string;
  year: number;
  halfDays: number;
  leaveType: { name: string };
}

export interface LeaveRequestRow {
  id: string;
  userId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  startDayPart: PrismaLeaveDayPart;
  endDayPart: PrismaLeaveDayPart;
  halfDays: number;
  reason: string;
  status: PrismaLeaveRequestStatus;
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: { name: string; email: string };
  leaveType: { name: string };
  reviewedBy: { name: string } | null;
}

const LEAVE_TYPE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  paid: true,
  allowHalfDay: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LeaveTypeSelect;

/** Shared by list and detail reads so the two can never drift apart. */
const LEAVE_REQUEST_SELECT = {
  id: true,
  userId: true,
  leaveTypeId: true,
  startDate: true,
  endDate: true,
  startDayPart: true,
  endDayPart: true,
  halfDays: true,
  reason: true,
  status: true,
  reviewedById: true,
  reviewedAt: true,
  reviewNote: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true, email: true } },
  leaveType: { select: { name: true } },
  reviewedBy: { select: { name: true } },
} satisfies Prisma.LeaveRequestSelect;

/**
 * The calendar's projection. Note what is ABSENT: `reason` and `reviewNote`. This is a
 * deliberate, structural omission rather than a field the mapper happens not to copy — the
 * calendar is company-wide, and if the reason were selected here, one careless spread in a
 * future mapper would publish everybody's medical detail to everybody. It cannot leak what
 * was never fetched.
 */
const LEAVE_CALENDAR_SELECT = {
  id: true,
  userId: true,
  startDate: true,
  endDate: true,
  startDayPart: true,
  endDayPart: true,
  status: true,
  user: { select: { name: true } },
  leaveType: { select: { name: true } },
} satisfies Prisma.LeaveRequestSelect;

export interface LeaveCalendarRow {
  id: string;
  userId: string;
  startDate: Date;
  endDate: Date;
  startDayPart: PrismaLeaveDayPart;
  endDayPart: PrismaLeaveDayPart;
  status: PrismaLeaveRequestStatus;
  user: { name: string };
  leaveType: { name: string };
}

export interface ListLeaveRequestsFilters {
  tenantId: string;
  page: number;
  pageSize: number;
  status?: PrismaLeaveRequestStatus;
  leaveTypeId?: string;
  year?: number;
  /** Scope-resolved. `undefined` means tenant-wide (scope=all). */
  userId?: string;
}

@Injectable()
export class LeaveRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transaction passthrough so the service never imports Prisma (CLAUDE.md §3.3). Mirrors
   * `CommerceRepository.runInTransaction`.
   */
  async runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // The extended client does not expose `$transaction` at the type level in a way that
    // satisfies its own extended type — the same limitation, and the same cast, as
    // `CommerceRepository.transaction`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma extended-client $transaction typing limitation
    return (this.prisma.client as any).$transaction(fn);
  }

  /**
   * The extended client, viewed as a plain transaction client, so a method can accept an
   * optional `tx` and fall back to a non-transactional call without TypeScript trying to
   * unify the two (structurally different) client types at every call site.
   */
  private get txClient(): Prisma.TransactionClient {
    return this.prisma.client as unknown as Prisma.TransactionClient;
  }

  // ── Configuration ───────────────────────────────────────────────────────

  async listLeaveTypes(tenantId: string, activeOnly: boolean): Promise<LeaveTypeRow[]> {
    return this.prisma.client.leaveType.findMany({
      where: { tenantId, deletedAt: null, ...(activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: LEAVE_TYPE_SELECT,
    });
  }

  async findLeaveTypeById(tenantId: string, id: string): Promise<LeaveTypeRow | null> {
    return this.prisma.client.leaveType.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: LEAVE_TYPE_SELECT,
    });
  }

  async findLeaveTypeByKey(tenantId: string, key: string): Promise<{ id: string } | null> {
    return this.prisma.client.leaveType.findFirst({
      where: { tenantId, key, deletedAt: null },
      select: { id: true },
    });
  }

  async createLeaveType(
    tenantId: string,
    data: {
      key: string;
      name: string;
      description: string | null;
      paid: boolean;
      allowHalfDay: boolean;
      active: boolean;
      sortOrder: number;
    },
  ): Promise<LeaveTypeRow> {
    return this.prisma.client.leaveType.create({
      data: { tenantId, ...data },
      select: LEAVE_TYPE_SELECT,
    });
  }

  async updateLeaveType(
    tenantId: string,
    id: string,
    data: Prisma.LeaveTypeUpdateInput,
  ): Promise<LeaveTypeRow | null> {
    const result = await this.prisma.client.leaveType.updateMany({
      where: { id, tenantId, deletedAt: null },
      data,
    });
    if (result.count === 0) return null;
    return this.findLeaveTypeById(tenantId, id);
  }

  /** Soft-delete (the extension rewrites `.delete()`). Returns false if the row was gone. */
  async deleteLeaveType(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.prisma.client.leaveType.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return false;
    await this.prisma.client.leaveType.delete({ where: { id } });
    return true;
  }

  /** Live requests against a type — the guard against deleting a type that history depends on. */
  async countRequestsForLeaveType(tenantId: string, leaveTypeId: string): Promise<number> {
    return this.prisma.client.leaveRequest.count({
      where: { tenantId, leaveTypeId, deletedAt: null },
    });
  }

  async listQuotas(tenantId: string, year: number): Promise<LeaveQuotaRow[]> {
    return this.prisma.client.leaveQuota.findMany({
      where: { tenantId, year, deletedAt: null },
      select: {
        id: true,
        leaveTypeId: true,
        year: true,
        halfDays: true,
        leaveType: { select: { name: true } },
      },
    });
  }

  /**
   * Save a whole year's allowances at once.
   *
   * One transaction, and an upsert per row rather than delete-then-insert: the partial-unique
   * index means a delete + insert in the same transaction would work, but it would also churn
   * a fresh `audit_logs` create for every unchanged allowance every time the grid is saved,
   * burying the one line that actually changed.
   */
  async saveQuotas(
    tenantId: string,
    year: number,
    allocations: ReadonlyArray<{ leaveTypeId: string; halfDays: number }>,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      for (const allocation of allocations) {
        const existing = await tx.leaveQuota.findFirst({
          where: { tenantId, year, leaveTypeId: allocation.leaveTypeId, deletedAt: null },
          select: { id: true, halfDays: true },
        });
        if (existing) {
          if (existing.halfDays === allocation.halfDays) continue;
          await tx.leaveQuota.update({
            where: { id: existing.id },
            data: { halfDays: allocation.halfDays },
          });
        } else {
          await tx.leaveQuota.create({
            data: { tenantId, year, leaveTypeId: allocation.leaveTypeId, halfDays: allocation.halfDays },
          });
        }
      }
    });
  }

  async listHolidays(tenantId: string, year: number): Promise<HolidayRow[]> {
    return this.prisma.client.holiday.findMany({
      where: {
        tenantId,
        deletedAt: null,
        date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      orderBy: { date: "asc" },
      select: { id: true, date: true, name: true, description: true, optional: true },
    });
  }

  async listHolidaysBetween(tenantId: string, from: Date, to: Date): Promise<HolidayRow[]> {
    return this.prisma.client.holiday.findMany({
      where: { tenantId, deletedAt: null, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, name: true, description: true, optional: true },
    });
  }

  async findHolidayOnDate(tenantId: string, date: Date): Promise<{ id: string } | null> {
    return this.prisma.client.holiday.findFirst({
      where: { tenantId, date, deletedAt: null },
      select: { id: true },
    });
  }

  async createHoliday(
    tenantId: string,
    data: { date: Date; name: string; description: string | null; optional: boolean },
  ): Promise<HolidayRow> {
    return this.prisma.client.holiday.create({
      data: { tenantId, ...data },
      select: { id: true, date: true, name: true, description: true, optional: true },
    });
  }

  async updateHoliday(
    tenantId: string,
    id: string,
    data: Prisma.HolidayUpdateInput,
  ): Promise<HolidayRow | null> {
    const result = await this.prisma.client.holiday.updateMany({
      where: { id, tenantId, deletedAt: null },
      data,
    });
    if (result.count === 0) return null;
    return this.prisma.client.holiday.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, date: true, name: true, description: true, optional: true },
    });
  }

  async deleteHoliday(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.prisma.client.holiday.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return false;
    await this.prisma.client.holiday.delete({ where: { id } });
    return true;
  }

  /**
   * The working week. Returns the tenant's row, or `null` if none has been configured — the
   * service supplies the default rather than this layer inventing one, so "nobody has set
   * this up" stays distinguishable from "somebody chose Sundays".
   */
  async findSetting(tenantId: string): Promise<{ weeklyOffDays: number[] } | null> {
    return this.prisma.client.leaveSetting.findFirst({
      where: { tenantId, deletedAt: null },
      select: { weeklyOffDays: true },
    });
  }

  async saveSetting(tenantId: string, weeklyOffDays: number[]): Promise<{ weeklyOffDays: number[] }> {
    const existing = await this.prisma.client.leaveSetting.findFirst({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.client.leaveSetting.update({
        where: { id: existing.id },
        data: { weeklyOffDays },
        select: { weeklyOffDays: true },
      });
    }
    return this.prisma.client.leaveSetting.create({
      data: { tenantId, weeklyOffDays },
      select: { weeklyOffDays: true },
    });
  }

  // ── Requests ────────────────────────────────────────────────────────────

  async listRequests(
    filters: ListLeaveRequestsFilters,
  ): Promise<{ rows: LeaveRequestRow[]; total: number }> {
    const where: Prisma.LeaveRequestWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.leaveTypeId ? { leaveTypeId: filters.leaveTypeId } : {}),
      ...(filters.year
        ? {
            startDate: {
              gte: new Date(Date.UTC(filters.year, 0, 1)),
              lte: new Date(Date.UTC(filters.year, 11, 31)),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.leaveRequest.findMany({
        where,
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: LEAVE_REQUEST_SELECT,
      }),
      this.prisma.client.leaveRequest.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * `scopedUserId` narrows the lookup rather than being checked afterwards, so an
   * out-of-scope id returns null and the service answers 404. A 403 would confirm the row
   * exists, which is itself a disclosure — the same posture as the leads repository.
   */
  async findRequestById(
    tenantId: string,
    id: string,
    scopedUserId?: string,
  ): Promise<LeaveRequestRow | null> {
    return this.prisma.client.leaveRequest.findFirst({
      where: { id, tenantId, deletedAt: null, ...(scopedUserId ? { userId: scopedUserId } : {}) },
      select: LEAVE_REQUEST_SELECT,
    });
  }

  /**
   * Create a request, refusing to overlap any live pending/approved request the same person
   * already holds.
   *
   * WHY A LOCK AND NOT AN INDEX. Overlap is a RANGE predicate, and no unique index can
   * express it. Postgres can, via
   *   EXCLUDE USING gist (user_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
   * but that needs `CREATE EXTENSION btree_gist`, and no migration in this repo has ever
   * imposed an extension prerequisite on a deployment target. So the serialisation uses the
   * primitive already proven here for invoice numbering
   * (`CommerceRepository.generateInvoiceNumber`): a transaction-scoped advisory lock,
   * released automatically on commit or rollback, needing no migration at all.
   *
   * Keyed on the USER rather than the tenant, because the invariant is per-person: two
   * different people applying in the same millisecond can never conflict, so there is no
   * cross-staff contention at all. (Invoice numbering keys on the tenant because ITS
   * invariant is tenant-wide. Ours is not.)
   */
  async createRequestGuardingOverlap(
    tx: Prisma.TransactionClient,
    data: {
      tenantId: string;
      userId: string;
      leaveTypeId: string;
      startDate: Date;
      endDate: Date;
      startDayPart: PrismaLeaveDayPart;
      endDayPart: PrismaLeaveDayPart;
      halfDays: number;
      reason: string;
    },
  ): Promise<{ created: LeaveRequestRow | null; conflict: LeaveRequestRow | null }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.userId}))`;

    const conflict = await tx.leaveRequest.findFirst({
      where: {
        tenantId: data.tenantId,
        userId: data.userId,
        deletedAt: null,
        status: { in: ["pending", "approved"] },
        // Two inclusive ranges overlap exactly when each starts on or before the other ends.
        startDate: { lte: data.endDate },
        endDate: { gte: data.startDate },
      },
      orderBy: { startDate: "asc" },
      select: LEAVE_REQUEST_SELECT,
    });
    if (conflict) return { created: null, conflict };

    const created = await tx.leaveRequest.create({
      data: { ...data, status: "pending" },
      select: LEAVE_REQUEST_SELECT,
    });
    return { created, conflict: null };
  }

  /** Takes the same per-user advisory lock as create, so approval serialises against it. */
  async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  }

  /**
   * Move a request between statuses, guarded on the CURRENT status in the WHERE rather than
   * trusting a prior read. Two super admins working the same queue must not both approve one
   * request, and the second write matching zero rows is how the service learns it lost the
   * race — which becomes a 409 rather than a silent double-deduction.
   *
   * This is a DIFFERENT race from the one `createRequestGuardingOverlap` closes. That one
   * guards an INSERT, where there is no row yet to re-check; this one guards a TRANSITION on
   * a row that already exists. Neither substitutes for the other.
   */
  async transitionRequestStatus(args: {
    tenantId: string;
    id: string;
    from: PrismaLeaveRequestStatus[];
    to: PrismaLeaveRequestStatus;
    actorId: string;
    note: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<number> {
    const client = args.tx ?? this.txClient;
    const result = await client.leaveRequest.updateMany({
      where: {
        id: args.id,
        tenantId: args.tenantId,
        deletedAt: null,
        status: { in: args.from },
      },
      data:
        args.to === "cancelled"
          ? { status: args.to, cancelledAt: new Date() }
          : {
              status: args.to,
              reviewedById: args.actorId,
              reviewedAt: new Date(),
              reviewNote: args.note,
            },
    });
    return result.count;
  }

  /**
   * Half-days per leave type for one person in one year, split by status.
   *
   * Grouped by type AND status in a single query so `approved` and `pending` come back
   * together — the balance needs both, and two round trips could see different states.
   *
   * `excludeRequestId` exists for the approval path: when re-checking the allowance for the
   * request being approved, that request's own pending half-days must not be counted on top
   * of the amount about to be approved.
   */
  async sumHalfDaysByTypeAndStatus(
    tenantId: string,
    userId: string,
    year: number,
    opts: { tx?: Prisma.TransactionClient; excludeRequestId?: string } = {},
  ): Promise<Array<{ leaveTypeId: string; status: PrismaLeaveRequestStatus; halfDays: number }>> {
    const client = opts.tx ?? this.txClient;
    const grouped = await client.leaveRequest.groupBy({
      by: ["leaveTypeId", "status"],
      where: {
        tenantId,
        userId,
        deletedAt: null,
        status: { in: ["approved", "pending"] },
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
        ...(opts.excludeRequestId ? { id: { not: opts.excludeRequestId } } : {}),
      },
      _sum: { halfDays: true },
    });

    return grouped.map((row) => ({
      leaveTypeId: row.leaveTypeId,
      status: row.status,
      halfDays: row._sum.halfDays ?? 0,
    }));
  }

  /**
   * Allowances for one year keyed by type. Read inside the approval transaction, so it takes
   * an optional `tx`.
   */
  async findQuotasForYear(
    tenantId: string,
    year: number,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ leaveTypeId: string; halfDays: number }>> {
    const client = tx ?? this.txClient;
    return client.leaveQuota.findMany({
      where: { tenantId, year, deletedAt: null },
      select: { leaveTypeId: true, halfDays: true },
    });
  }

  /**
   * Leave types referenced by a person's requests in a year, EVEN IF since deleted or
   * deactivated. Without this, an approved request against a leave type that was later
   * removed would vanish from the balance screen while still having been deducted — the
   * allowance would appear to have leaked.
   */
  async listLeaveTypesForUserYear(
    tenantId: string,
    userId: string,
    year: number,
  ): Promise<LeaveTypeRow[]> {
    const referenced = await this.prisma.client.leaveRequest.findMany({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        status: { in: ["approved", "pending"] },
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      select: { leaveTypeId: true },
      distinct: ["leaveTypeId"],
    });
    if (referenced.length === 0) return [];

    // `includeDeleted` is not a thing on the extension, so this reads the non-audited base
    // client to reach soft-deleted rows deliberately — the one place in this module that
    // needs a row the soft-delete filter would hide. Tenant scoping is still explicit.
    return this.prisma.baseClient.leaveType.findMany({
      where: { tenantId, id: { in: referenced.map((r) => r.leaveTypeId) } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: LEAVE_TYPE_SELECT,
    });
  }

  /**
   * Everything overlapping a date window, for the calendar: approved leave for everybody,
   * plus the caller's own pending requests so they can see what they have asked for.
   *
   * Reads through `LEAVE_CALENDAR_SELECT`, which does not fetch `reason` at all.
   */
  async listCalendarWindow(
    tenantId: string,
    from: Date,
    to: Date,
    actorId: string,
  ): Promise<LeaveCalendarRow[]> {
    return this.prisma.client.leaveRequest.findMany({
      where: {
        tenantId,
        deletedAt: null,
        startDate: { lte: to },
        endDate: { gte: from },
        OR: [{ status: "approved" }, { status: "pending", userId: actorId }],
      },
      orderBy: [{ startDate: "asc" }],
      select: LEAVE_CALENDAR_SELECT,
    });
  }

  /**
   * Live, ACTIVE super_admin users in this tenant — the fan-out list for `leave_requested`.
   * Query shape lifted from `LeadsRepository.listAssignableUsers`.
   *
   * `status: "active"` and `deletedAt: null` on BOTH the role and the user matter: an
   * offboarded or never-activated super admin silently becoming the only recipient of every
   * approval request is exactly how a queue goes unwatched for a month.
   */
  async listApprovers(tenantId: string): Promise<Array<{ id: string; name: string; email: string }>> {
    const rows = await this.prisma.client.userRole.findMany({
      where: {
        deletedAt: null,
        role: { tenantId, key: "super_admin", deletedAt: null },
        user: { tenantId, deletedAt: null, status: "active" },
      },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });

    // A user holding super_admin through more than one branch-scoped assignment would appear
    // twice, and would then be emailed twice about the same request.
    const byId = new Map(rows.map((row) => [row.userId, { id: row.userId, ...row.user }]));
    return [...byId.values()];
  }

  async findUserName(tenantId: string, userId: string): Promise<{ name: string; email: string } | null> {
    return this.prisma.client.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { name: true, email: true },
    });
  }
}
