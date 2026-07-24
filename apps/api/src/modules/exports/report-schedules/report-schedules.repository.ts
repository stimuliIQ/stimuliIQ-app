// apps/api/src/modules/exports/report-schedules/report-schedules.repository.ts
//
// Prisma data access ONLY for `report_schedules` (docs/plans/phase-7.md Wave 2 task #11,
// CLAUDE.md §3.3: "repository — Prisma data access only ... No business logic"). Every
// query is ALWAYS tenant-scoped. `PrismaService`'s soft-delete extension auto-filters
// `deletedAt: null` on every find*/count read (see soft-delete.extension.ts) — this
// repository does not repeat that filter on reads, EXCEPT inside `claimDueSchedule()`,
// which uses a raw `updateMany` (not auto-filtered — see that method's comment) and must
// add it by hand.

import { Injectable } from "@nestjs/common";
import type { Prisma, ReportScheduleFrequency, ReportScheduleRunStatus } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";

export interface ReportScheduleRow {
  id: string;
  tenantId: string;
  createdById: string;
  createdByName: string | null;
  type: string;
  format: string;
  params: Prisma.JsonValue;
  frequency: ReportScheduleFrequency;
  recipientEmail: string | null;
  active: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: ReportScheduleRunStatus | null;
  lastError: string | null;
  createdAt: Date;
}

export interface CreateReportScheduleInput {
  tenantId: string;
  createdById: string;
  type: string;
  format: string;
  params: Record<string, unknown>;
  frequency: ReportScheduleFrequency;
  recipientEmail: string | null;
  nextRunAt: Date;
}

export interface ListReportSchedulesFilters {
  tenantId: string;
  /** Restrict to schedules created by this user (own/branch/assigned-scope callers — report_schedules carries no branch/batch column of its own, mirrors export_jobs). */
  createdById?: string;
  type?: string;
  active?: boolean;
  page: number;
  pageSize: number;
}

const INCLUDE_CREATED_BY = { createdBy: { select: { name: true } } } as const;

@Injectable()
export class ReportSchedulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateReportScheduleInput): Promise<ReportScheduleRow> {
    const row = await this.prisma.client.reportSchedule.create({
      data: {
        tenantId: input.tenantId,
        createdById: input.createdById,
        type: input.type,
        format: input.format,
        params: input.params as Prisma.InputJsonValue,
        frequency: input.frequency,
        recipientEmail: input.recipientEmail,
        nextRunAt: input.nextRunAt,
      },
      include: INCLUDE_CREATED_BY,
    });
    return toRow(row);
  }

  async findById(tenantId: string, id: string): Promise<ReportScheduleRow | null> {
    const row = await this.prisma.client.reportSchedule.findFirst({
      where: { id, tenantId },
      include: INCLUDE_CREATED_BY,
    });
    return row ? toRow(row) : null;
  }

  async list(filters: ListReportSchedulesFilters): Promise<{ rows: ReportScheduleRow[]; total: number }> {
    const where: Prisma.ReportScheduleWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.createdById ? { createdById: filters.createdById } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.active !== undefined ? { active: filters.active } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.reportSchedule.findMany({
        where,
        include: INCLUDE_CREATED_BY,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.reportSchedule.count({ where }),
    ]);

    return { rows: rows.map(toRow), total };
  }

  async update(
    tenantId: string,
    id: string,
    data: { frequency?: ReportScheduleFrequency; recipientEmail?: string | null; active?: boolean; nextRunAt?: Date },
  ): Promise<ReportScheduleRow> {
    const row = await this.prisma.client.reportSchedule.update({
      where: { id },
      data,
      include: INCLUDE_CREATED_BY,
    });
    void tenantId; // tenant membership already verified by the service's prior findById() call.
    return toRow(row);
  }

  /** Soft-delete (rewritten to `deletedAt: now()` by the soft-delete extension). */
  async softDelete(id: string): Promise<void> {
    await this.prisma.client.reportSchedule.delete({ where: { id } });
  }

  // ─── Dispatch cron (ReportScheduleDispatchScheduler) ────────────────────────

  /**
   * Finds candidate due schedules across ALL tenants (a platform-wide cron, not a
   * per-request tenant-scoped call — there is no `ScopeInterceptor`/tenant context in a
   * background job). Each row's `nextRunAt` is read here and passed BACK into
   * `claimDueSchedule()` as the optimistic-concurrency guard value — see that method.
   */
  async findDueCandidates(now: Date, limit: number): Promise<ReportScheduleRow[]> {
    const rows = await this.prisma.client.reportSchedule.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      include: INCLUDE_CREATED_BY,
      orderBy: { nextRunAt: "asc" },
      take: limit,
    });
    return rows.map(toRow);
  }

  /**
   * Atomically claims a due schedule for this dispatch tick: advances `nextRunAt` to the
   * next window and stamps `lastRunAt = now()`, but ONLY if `nextRunAt` still equals the
   * value observed by `findDueCandidates()` (optimistic-concurrency / "compare-and-swap"
   * on `next_run_at`) — this is the idempotent-single-fire guard: if a concurrent
   * scheduler tick (or a second app replica) already claimed this row, `count` is 0 and
   * the caller MUST skip it rather than generate/send a duplicate report.
   *
   * Uses a raw `updateMany` (NOT auto-filtered for `deletedAt` by the soft-delete
   * extension — that filter only applies to findMany/count/aggregate/groupBy reads) — the
   * `deletedAt: null` + `active: true` conditions are added explicitly here so a
   * soft-deleted or already-deactivated row can never be claimed.
   *
   * Returns `true` iff this call won the claim.
   */
  async claimDueSchedule(id: string, observedNextRunAt: Date, newNextRunAt: Date, now: Date): Promise<boolean> {
    const result = await this.prisma.client.reportSchedule.updateMany({
      where: { id, nextRunAt: observedNextRunAt, active: true, deletedAt: null },
      data: { nextRunAt: newNextRunAt, lastRunAt: now },
    });
    return result.count === 1;
  }

  /** Records the outcome of a claimed run (AC-38: failures are surfaced, never silently dropped). */
  async recordRunOutcome(id: string, status: ReportScheduleRunStatus, error: string | null): Promise<void> {
    await this.prisma.client.reportSchedule.update({
      where: { id },
      data: { lastStatus: status, lastError: error },
    });
  }

  /** AC-37 "skip/deactivate": the creator lost the required permission entirely. */
  async deactivate(id: string, error: string): Promise<void> {
    await this.prisma.client.reportSchedule.update({
      where: { id },
      data: { active: false, lastStatus: "failed", lastError: error },
    });
  }
}

function toRow(row: {
  id: string;
  tenantId: string;
  createdById: string;
  type: string;
  format: string;
  params: Prisma.JsonValue;
  frequency: ReportScheduleFrequency;
  recipientEmail: string | null;
  active: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: ReportScheduleRunStatus | null;
  lastError: string | null;
  createdAt: Date;
  createdBy: { name: string } | null;
}): ReportScheduleRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    type: row.type,
    format: row.format,
    params: row.params,
    frequency: row.frequency,
    recipientEmail: row.recipientEmail,
    active: row.active,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}
