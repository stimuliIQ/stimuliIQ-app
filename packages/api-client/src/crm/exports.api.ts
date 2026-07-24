// Typed reports+exports SDK — Phase 7, Wave 1 (docs/plans/phase-7.md task #4).
//
// Namespace: client.crm.exports.*  (job trigger/poll/history)
//            client.crm.reportSchedules.*  (recurring report emails)
//
// SECURITY CONTRACTS (docs/specs/phase-7-analytics-hardening.md):
//   - AC-30/31/32/Rule H-2: `create()`'s `params` is the SAME query shape as
//     the on-screen dashboard/list it mirrors (imported types, not
//     hand-shaped) — there is no separate, broader export query path.
//   - AC-33: large exports run as a background job; poll `get(id)` for the
//     signed download URL rather than blocking on a single request.
//   - AC-34: requires `reports.export` IN ADDITION to the domain's
//     `reports.<domain>.view` (view-only users get 403 here).
//   - AC-35: `downloadUrl` is signed + short-lived — never cache/persist it
//     client-side beyond the current session; re-poll `get(id)` for a fresh link.
//   - AC-37: a schedule's recipient scope is re-evaluated at SEND time, not
//     creation time — this SDK never sends a scope snapshot.

import type {
  CreateExportRequestDto,
  ExportJobDto,
  ListExportJobsQuery,
  CreateReportScheduleDto,
  UpdateReportScheduleDto,
  ReportScheduleDto,
  ListReportSchedulesQuery,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class ExportsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/crm/exports — trigger an on-demand CSV/PDF export.
   * Returns the job in 'queued'/'running' state; poll `get(id)` for completion.
   * Permissions: reports.export (mirrors the domain's view permission scope).
   */
  async create(
    body: CreateExportRequestDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ExportJobDto> {
    return this.client.request<ExportJobDto>("POST", "/api/v1/crm/exports", { body, idempotencyKey });
  }

  /** GET /api/v1/crm/exports/:id — poll job status / signed download URL (null until 'succeeded'). */
  async get(id: string): Promise<ExportJobDto> {
    return this.client.request<ExportJobDto>("GET", `/api/v1/crm/exports/${id}`);
  }

  /** GET /api/v1/crm/exports — export history, paginated. */
  async list(query: ListExportJobsQuery) {
    return this.client.requestPaginated<ExportJobDto>(
      "GET",
      `/api/v1/crm/exports${toQueryString(query)}`,
    );
  }
}

export class ReportSchedulesApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/crm/reports/schedules — create a recurring report email.
   * LOCK-D2: dispatch reuses the P6 Resend sync-seam. AC-37: scope is
   * re-evaluated at send time from the recipient's live session, never stored here.
   */
  async create(
    body: CreateReportScheduleDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ReportScheduleDto> {
    return this.client.request<ReportScheduleDto>("POST", "/api/v1/crm/reports/schedules", {
      body,
      idempotencyKey,
    });
  }

  /** GET /api/v1/crm/reports/schedules — list, paginated. */
  async list(query: ListReportSchedulesQuery) {
    return this.client.requestPaginated<ReportScheduleDto>(
      "GET",
      `/api/v1/crm/reports/schedules${toQueryString(query)}`,
    );
  }

  /** PATCH /api/v1/crm/reports/schedules/:id — cadence/recipient/active toggle only (type/params are immutable). */
  async update(
    id: string,
    body: UpdateReportScheduleDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ReportScheduleDto> {
    return this.client.request<ReportScheduleDto>(
      "PATCH",
      `/api/v1/crm/reports/schedules/${id}`,
      { body, idempotencyKey },
    );
  }

  /** DELETE /api/v1/crm/reports/schedules/:id */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<ReportScheduleDto> {
    return this.client.request<ReportScheduleDto>(
      "DELETE",
      `/api/v1/crm/reports/schedules/${id}`,
      { idempotencyKey },
    );
  }
}
