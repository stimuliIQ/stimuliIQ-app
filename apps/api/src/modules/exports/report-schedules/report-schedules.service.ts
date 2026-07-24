// apps/api/src/modules/exports/report-schedules/report-schedules.service.ts
//
// Business logic for recurring report-email schedules (docs/plans/phase-7.md Wave 2
// task #11, docs/specs/phase-7-analytics-hardening.md WS-B AC-37/38/39). CLAUDE.md §3.3:
// "service — business logic ... No Prisma in controllers."
//
// This is the CRUD side (POST/GET/PATCH/DELETE /crm/reports/schedules). The actual
// send-time re-evaluation (AC-37) lives in `ReportScheduleDispatchScheduler` — this
// service creates/reads/updates/deactivates schedule DEFINITIONS only and never itself
// generates or sends a report.
//
// AC-34-equivalent gate: creating a schedule requires BOTH `reports.schedule` (checked by
// the controller's `@RequirePermission`) AND the domain-specific view permission for the
// report `type` being scheduled (`assertCanScheduleType`, mirrors
// `ExportsService.assertCanExportType` via the SHARED `TYPE_VIEW_PERMISSION` map) — a
// Counsellor who can view the funnel report can schedule it; a Counsellor cannot schedule
// a revenue report they cannot even view on-screen.
//
// Ownership/visibility (mirrors ExportsService.list/getById exactly — report_schedules
// carries no branch/batch column of its own): an "all"-scope caller (admin/finance/
// marketing at scope=all for `reports.schedule`) sees/manages every schedule in the
// tenant; every other scope sees/manages only schedules THEY personally created.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateReportScheduleDto,
  ReportScheduleDto,
  UpdateReportScheduleDto,
  ListReportSchedulesQuery,
  ExportEntityType,
} from "@repo/types";
import { PaginatedResult } from "../../../common/dto/paginated-result";
import { requireScopeContext } from "../../auth/lib/scope-context";
import type { RequestUser } from "../../auth/lib/request-user";
import { TYPE_VIEW_PERMISSION } from "../lib/type-view-permission";
import { ReportSchedulesRepository, type ReportScheduleRow } from "./report-schedules.repository";
import { computeNextRunAt } from "./lib/next-run";

@Injectable()
export class ReportSchedulesService {
  constructor(private readonly repo: ReportSchedulesRepository) {}

  // ─── POST /api/v1/crm/reports/schedules ─────────────────────────────────────

  async create(tenantId: string, user: RequestUser, dto: CreateReportScheduleDto): Promise<ReportScheduleDto> {
    this.assertCanScheduleType(user, dto.type);

    const now = new Date();
    const row = await this.repo.create({
      tenantId,
      createdById: user.id,
      type: dto.type,
      format: dto.format,
      params: dto.params as Record<string, unknown>,
      frequency: dto.frequency,
      recipientEmail: dto.recipientEmail ?? null,
      // First send happens one cadence AFTER creation (not immediately) — a schedule
      // created "just now" fires on its first natural window, not on the next cron tick.
      nextRunAt: computeNextRunAt(now, dto.frequency),
    });

    return this.toDto(row);
  }

  // ─── GET /api/v1/crm/reports/schedules/:id ──────────────────────────────────

  async getById(tenantId: string, user: RequestUser, id: string): Promise<ReportScheduleDto> {
    const row = await this.repo.findById(tenantId, id);
    if (!row || !this.isVisibleToCaller(row, user)) {
      throw new NotFoundException({ code: "report_schedules.not_found", title: "Report schedule not found" });
    }
    return this.toDto(row);
  }

  // ─── GET /api/v1/crm/reports/schedules ──────────────────────────────────────

  async list(
    tenantId: string,
    user: RequestUser,
    query: ListReportSchedulesQuery,
  ): Promise<PaginatedResult<ReportScheduleDto>> {
    const scope = requireScopeContext();
    const createdById = scope.scope === "all" ? undefined : user.id;

    const { rows, total } = await this.repo.list({
      tenantId,
      createdById,
      type: query.type,
      active: query.active,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult(rows.map((row) => this.toDto(row)), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  // ─── PATCH /api/v1/crm/reports/schedules/:id ────────────────────────────────

  async update(
    tenantId: string,
    user: RequestUser,
    id: string,
    dto: UpdateReportScheduleDto,
  ): Promise<ReportScheduleDto> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing || !this.isVisibleToCaller(existing, user)) {
      throw new NotFoundException({ code: "report_schedules.not_found", title: "Report schedule not found" });
    }

    // Re-basing `nextRunAt` on a frequency change: if the cadence changes (e.g.
    // weekly -> daily), the next fire is recomputed from the LAST run (or creation, if it
    // has never run) using the NEW frequency, rather than leaving a stale window computed
    // under the old cadence.
    const nextRunAt =
      dto.frequency && dto.frequency !== existing.frequency
        ? computeNextRunAt(existing.lastRunAt ?? existing.createdAt, dto.frequency)
        : undefined;

    const row = await this.repo.update(tenantId, id, {
      frequency: dto.frequency,
      recipientEmail: dto.recipientEmail === undefined ? undefined : dto.recipientEmail,
      active: dto.active,
      nextRunAt,
    });
    return this.toDto(row);
  }

  // ─── DELETE /api/v1/crm/reports/schedules/:id ───────────────────────────────

  async remove(tenantId: string, user: RequestUser, id: string): Promise<ReportScheduleDto> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing || !this.isVisibleToCaller(existing, user)) {
      throw new NotFoundException({ code: "report_schedules.not_found", title: "Report schedule not found" });
    }
    await this.repo.softDelete(id);
    return this.toDto({ ...existing, active: false });
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────────

  private assertCanScheduleType(user: RequestUser, type: ExportEntityType): void {
    const requiredViewPermission = TYPE_VIEW_PERMISSION[type];
    const hasViewPermission = user.permissions.some((p) => p.key === requiredViewPermission);
    if (!hasViewPermission) {
      throw new ForbiddenException({
        code: "report_schedules.view_permission_required",
        title: "Scheduling not permitted",
        detail: `Scheduling a "${type}" report additionally requires the "${requiredViewPermission}" permission.`,
      });
    }
  }

  private isVisibleToCaller(row: ReportScheduleRow, user: RequestUser): boolean {
    const scope = requireScopeContext();
    if (scope.scope === "all") return true;
    return row.createdById === user.id;
  }

  private toDto(row: ReportScheduleRow): ReportScheduleDto {
    return {
      id: row.id,
      type: row.type as ExportEntityType,
      format: row.format as ReportScheduleDto["format"],
      frequency: row.frequency,
      recipientEmail: row.recipientEmail,
      active: row.active,
      nextRunAt: row.nextRunAt.toISOString(),
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      lastStatus: row.lastStatus,
      lastError: row.lastError,
      createdByName: row.createdByName ?? "Unknown",
      createdAt: row.createdAt.toISOString(),
    };
  }
}
