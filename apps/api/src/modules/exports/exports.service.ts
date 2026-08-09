// apps/api/src/modules/exports/exports.service.ts
//
// Business logic for on-demand CSV/PDF exports (docs/plans/phase-7.md task #8,
// docs/specs/phase-7-analytics-hardening.md WS-B). CLAUDE.md §3.3: "service — business
// logic, transactions, idempotency, emits domain events post-commit. No Prisma in
// controllers."
//
// ─── RULE H-2 (AC-30/31/32) — HOW SCOPE ISOLATION IS ENFORCED HERE ─────────────────
//
// This service NEVER re-implements a scope filter. For every exportable `type` it
// calls the SAME already-scoped service method the matching on-screen dashboard/list
// endpoint calls:
//   revenue/enrollments/funnel/engagement/campaigns/gamification/
//   forum-health -> AnalyticsService (the exact WS-A dashboard methods, task #7)
//   students     -> StudentsService.list()      (students.controller.ts's own method)
//   leads        -> LeadsService.list()         (leads.controller.ts's own method)
//   payments     -> CommerceService.listPayments() (commerce.controller.ts's own method)
//   campaign-audience -> CampaignsService.listRecipients() (campaigns.controller.ts's
//                        own method), enriched via LeadsRepository/StudentsRepository
//                        tenant-scoped lookups for display fields (name/source/stage).
// Every one of those methods reads `requireScopeContext()` off the SAME AsyncLocalStorage
// the ScopeInterceptor populated for THIS request (matched against `reports.export`,
// see auth/lib/scope-context.ts) — so a Branch Manager's export is restricted to their
// branch exactly as their on-screen view would be, with zero duplicated scope logic.
//
// ─── AC-34 / edge-case-table: "export requires a permission the caller cannot view" ──
//
// `reports.export` alone is necessary but not sufficient: the caller must ALSO hold
// the view-permission for the specific domain being exported (the same permission
// that gates the on-screen equivalent) — see `TYPE_VIEW_PERMISSION` (./lib/type-view-
// permission.ts, shared with ReportSchedulesService/ReportScheduleDispatchScheduler,
// Wave 2 task #11). This check
// runs BEFORE the export_jobs row is created and before any query executes (edge-case
// table: "Export requested for a report the caller cannot view -> 403 before any query
// runs"). It is a cheap in-memory check against `RequestUser.permissions` (already
// resolved at login/session-refresh time) — no extra DB round trip.
//
// KNOWN SIMPLIFICATION (documented, not a security gap): docs/specs/phase-7-analytics-
// hardening.md Part 8's `reports.export` grant table carries per-role parentheticals
// ("own (funnel only)", "assigned (own domains)", "all (campaigns)") that read as a
// stricter role-specific TYPE allowlist than "holds the matching <domain>.view
// permission". This service implements the latter (permission-based), which is a
// STRICT SUBSET of what any role could already see on-screen (never broader) — it is
// therefore not a scope leak, only a possibly-more-permissive-than-intended export
// surface for a couple of roles (e.g. a Counsellor who already holds `leads.view`
// own-scope could also export their own leads, not just the funnel report). Flagged
// for security-reviewer / product follow-up if a stricter per-role allowlist is
// desired; every ACTUAL data-scope boundary (tenant/branch/assigned/own) is enforced
// regardless.
//
// ─── AC-33 (large exports) ──────────────────────────────────────────────────────────
//
// Report-backed types (1-8) are single already-aggregated dashboard calls — bounded
// size by construction (a handful of series points / stage rows / lesson rows), so
// they are rendered in one pass. Entity-list types (9-12) can be tens of thousands of
// rows — these are fetched in BOUNDED PAGES (PAGE_SIZE, the same max the on-screen
// list endpoints already enforce) via a loop that appends each page directly to
// `IncrementalCsvWriter` and discards the page's rows once converted, rather than ever
// materializing the full result set as one in-memory array of raw entity objects.
//
// ─── LOCK-D2 (sync-seam, no BullMQ) ─────────────────────────────────────────────────
//
// Per the phase-7 plan (memory: "P6 decisions — sync-seam (no BullMQ)"), export
// generation runs INLINE within the POST /crm/exports request — there is no queue.
// `export_jobs.status` still transitions queued -> running -> succeeded|failed so the
// DTO/poll contract (GET .../exports/:id) is forward-compatible with a future BullMQ
// worker (ADR-0020 migration seam) without any client-visible change.

import { ForbiddenException, HttpException, Injectable, Logger, NotFoundException, Inject } from "@nestjs/common";
import type {
  CreateExportRequestDto,
  ExportJobDto,
  ListExportJobsQuery,
  ExportEntityType,
  CampaignAudienceExportRow,
  ExportStudentsParams,
  ExportLeadsParams,
  ExportPaymentsParams,
} from "@repo/types";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import type { RequestUser } from "../auth/lib/request-user";
import { ExportsRepository, type ExportJobRow } from "./exports.repository";
import { AnalyticsService } from "../analytics/analytics.service";
import { StudentsService } from "../students/students.service";
import { LeadsService } from "../leads/leads.service";
import { CommerceService } from "../commerce/commerce.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { LeadsRepository } from "../leads/leads.repository";
import { StudentsRepository } from "../students/students.repository";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { buildStorageKey } from "../storage/providers/storage/s3-storage.provider";
import { REPORT_PDF_PORT, type ReportPdfPort } from "./providers/pdf/report-pdf-port.interface";
import { IncrementalCsvWriter, rowsToCsv } from "./lib/csv";
import { TYPE_VIEW_PERMISSION } from "./lib/type-view-permission";
import {
  revenueRows,
  enrollmentsRows,
  funnelRows,
  engagementRows,
  campaignsRows,
  gamificationRows,
  forumHealthRows,
  STUDENTS_EXPORT_HEADERS,
  studentExportRow,
  LEADS_EXPORT_HEADERS,
  leadExportRow,
  PAYMENTS_EXPORT_HEADERS,
  paymentExportRow,
  CAMPAIGN_AUDIENCE_EXPORT_HEADERS,
  campaignAudienceExportRow,
} from "./lib/row-builders";

/** Max rows fetched per underlying-service page call — mirrors the platform-wide
 * `PageQuerySchema` ceiling (packages/types/src/common/pagination.ts), so exports never
 * request a page larger than the on-screen list endpoints themselves ever allow. */
const PAGE_SIZE = 100;

/** Defensive ceiling on the number of pages an entity-list export will page through
 * (100 * 5000 = 500,000 rows) — guards against an unexpected `hasMore` bug turning into
 * an infinite loop; a real tenant should never legitimately exceed this. */
const MAX_PAGES = 5000;

interface GeneratedFile {
  bytes: Buffer;
  contentType: "text/csv" | "application/pdf";
  rowCount: number;
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly repo: ExportsRepository,
    private readonly analytics: AnalyticsService,
    private readonly studentsService: StudentsService,
    private readonly leadsService: LeadsService,
    private readonly commerceService: CommerceService,
    private readonly campaignsService: CampaignsService,
    private readonly leadsRepository: LeadsRepository,
    private readonly studentsRepository: StudentsRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(REPORT_PDF_PORT) private readonly reportPdf: ReportPdfPort,
  ) {}

  // ─── POST /api/v1/crm/exports ───────────────────────────────────────────────

  async create(tenantId: string, user: RequestUser, dto: CreateExportRequestDto): Promise<ExportJobDto> {
    this.assertCanExportType(user, dto.type);

    const job = await this.repo.create({
      tenantId,
      requestedById: user.id,
      type: dto.type,
      format: dto.format,
      params: dto.params as Record<string, unknown>,
    });

    await this.repo.markRunning(job.id);

    let finalRow = job;
    try {
      const generated = await this.generate(tenantId, dto);
      const key = buildStorageKey({
        namespace: "exports",
        tenantId,
        uniqueId: job.id,
        extension: dto.format,
      });
      await this.storage.putObject({ key, body: generated.bytes, contentType: generated.contentType });
      await this.repo.markSucceeded(job.id, { storageKey: key, rowCount: generated.rowCount });

      // AC-36: explicit entity='export' audit row (separate from the ExportJob model's
      // own create/update audit trail — see exports.repository.ts file header).
      await this.repo.writeAuditLog({
        tenantId,
        actorId: user.id,
        entityId: job.id,
        action: "export.create",
        after: { type: dto.type, format: dto.format, params: dto.params, rowCount: generated.rowCount },
      });

      const refreshed = await this.repo.findById(tenantId, job.id);
      finalRow = refreshed ?? job;
    } catch (err) {
      const sanitized = this.sanitizeError(err);
      try {
        await this.repo.markFailed(job.id, sanitized);
      } catch (auditErr) {
        // Never let a failure to WRITE the failure state mask the original error.
        this.logger.error(`[ExportsService] failed to record export failure job=${job.id}: ${String(auditErr)}`);
      }
      // Scope/permission failures (IDOR -> 404, unresolvable scope -> 403) surfaced by
      // the underlying scoped service are re-thrown as-is so the caller sees the real
      // HTTP status immediately, rather than a misleadingly-generic "failed" job
      // (matches the platform-wide fail-closed/IDOR convention every other module uses).
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(`[ExportsService] export generation failed job=${job.id}: ${String(err)}`);
      const refreshed = await this.repo.findById(tenantId, job.id);
      finalRow = refreshed ?? job;
    }

    return this.toDto(tenantId, finalRow);
  }

  // ─── GET /api/v1/crm/exports/:id ────────────────────────────────────────────

  async getById(tenantId: string, user: RequestUser, id: string): Promise<ExportJobDto> {
    const row = await this.repo.findById(tenantId, id);
    if (!row || !this.isVisibleToCaller(row, user)) {
      throw new NotFoundException({ code: "exports.not_found", title: "Export job not found" });
    }
    return this.toDto(tenantId, row);
  }

  // ─── GET /api/v1/crm/exports ─────────────────────────────────────────────────

  async list(tenantId: string, user: RequestUser, query: ListExportJobsQuery): Promise<PaginatedResult<ExportJobDto>> {
    const scope = requireScopeContext();
    // export_jobs carries no branch/batch column of its own (Wave-1 schema) — an
    // "all"-scope caller (admin/finance/marketing at scope=all for reports.export)
    // sees every export job in the tenant; every other scope value sees only jobs
    // THEY personally requested (there is no other dimension to restrict by).
    const requestedById = scope.scope === "all" ? undefined : user.id;

    const { rows, total } = await this.repo.list({
      tenantId,
      requestedById,
      type: query.type,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });

    const dtos = await Promise.all(rows.map((row) => this.toDto(tenantId, row)));
    return new PaginatedResult(dtos, {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  // ─── Permission gate (AC-34) ─────────────────────────────────────────────────

  private assertCanExportType(user: RequestUser, type: ExportEntityType): void {
    const requiredViewPermission = TYPE_VIEW_PERMISSION[type];
    const hasViewPermission = user.permissions.some((p) => p.key === requiredViewPermission);
    if (!hasViewPermission) {
      throw new ForbiddenException({
        code: "exports.view_permission_required",
        title: "Export not permitted",
        detail: `Exporting "${type}" additionally requires the "${requiredViewPermission}" permission.`,
      });
    }
  }

  /** `undefined` requestedById on a row means "visible to all-scope callers only" is NOT modeled at the row level — the scope check happens once, in `list()`/`getById()` via the caller's OWN resolved scope, matching the same all-vs-own split. */
  private isVisibleToCaller(row: ExportJobRow, user: RequestUser): boolean {
    const scope = requireScopeContext();
    if (scope.scope === "all") return true;
    return row.requestedById === user.id;
  }

  // ─── DTO mapping (mints a fresh signed download URL on every read — AC-35) ──────

  private async toDto(tenantId: string, row: ExportJobRow): Promise<ExportJobDto> {
    void tenantId;
    let downloadUrl: string | null = null;
    let downloadUrlExpiresAt: string | null = null;

    if (row.status === "succeeded" && row.storageKey) {
      const signed = await this.storage.getSignedDownloadUrl({ key: row.storageKey });
      downloadUrl = signed.url;
      downloadUrlExpiresAt = signed.expiresAt.toISOString();
    }

    return {
      id: row.id,
      type: row.type as ExportEntityType,
      format: row.format as ExportJobDto["format"],
      status: row.status,
      rowCount: row.rowCount,
      downloadUrl,
      downloadUrlExpiresAt,
      error: row.error,
      requestedByName: row.requestedByName,
      requestedAt: row.createdAt.toISOString(),
      completedAt: row.status === "succeeded" || row.status === "failed" ? row.updatedAt.toISOString() : null,
    };
  }

  private sanitizeError(err: unknown): string {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (typeof response === "string") return response;
      if (response && typeof response === "object" && "title" in response) {
        return String((response as { title: unknown }).title);
      }
      return err.message;
    }
    // Never surface a raw stack trace / internal error message for unexpected failures.
    return "Export generation failed. Please retry or contact support if this persists.";
  }

  // ─── Generation dispatch ─────────────────────────────────────────────────────

  private async generate(tenantId: string, dto: CreateExportRequestDto): Promise<GeneratedFile> {
    switch (dto.type) {
      case "revenue": {
        const report = await this.analytics.getRevenue(tenantId, dto.params);
        return this.renderReport(dto.format, `Revenue Report (${report.from} to ${report.to})`, report.asOf, report.stale, revenueRows(report));
      }
      case "enrollments": {
        const report = await this.analytics.getEnrollmentTrend(tenantId, dto.params);
        return this.renderReport(dto.format, `Enrollment Trend (${report.from} to ${report.to})`, report.asOf, report.stale, enrollmentsRows(report));
      }
      case "funnel": {
        const report = await this.analytics.getFunnel(tenantId, dto.params);
        return this.renderReport(dto.format, `Lead Funnel (${report.from} to ${report.to})`, report.asOf, report.stale, funnelRows(report));
      }
      case "engagement": {
        const report = await this.analytics.getEngagement(tenantId, dto.params);
        return this.renderReport(dto.format, "Course Engagement Report", report.asOf, report.stale, engagementRows(report));
      }
      case "campaigns": {
        const report = await this.analytics.getCampaignPerformance(tenantId, dto.params);
        return this.renderReport(dto.format, `Campaign Performance — ${report.campaignName}`, report.asOf, report.stale, campaignsRows(report));
      }
      case "gamification": {
        const report = await this.analytics.getGamificationParticipation(tenantId, dto.params);
        return this.renderReport(dto.format, "Gamification Participation Report", report.asOf, report.stale, gamificationRows(report));
      }
      case "forum-health": {
        const report = await this.analytics.getForumHealth(tenantId, dto.params);
        return this.renderReport(dto.format, "Forum Health Report", report.asOf, report.stale, forumHealthRows(report));
      }
      case "students":
        return this.generateStudents(tenantId, dto.params);
      case "leads":
        return this.generateLeads(tenantId, dto.params);
      case "payments":
        return this.generatePayments(tenantId, dto.params);
      case "campaign-audience":
        return this.generateCampaignAudience(tenantId, dto.params.campaignId);
    }
  }

  /** Shared CSV/PDF renderer for the 8 report-backed types (single already-aggregated call, bounded size). */
  private async renderReport(
    format: "csv" | "pdf",
    title: string,
    asOf: string,
    stale: boolean,
    rowSet: { headers: string[]; rows: unknown[][] },
  ): Promise<GeneratedFile> {
    if (format === "csv") {
      const csv = rowsToCsv(rowSet.headers, rowSet.rows);
      return { bytes: Buffer.from(csv, "utf8"), contentType: "text/csv", rowCount: rowSet.rows.length };
    }
    const subtitle = stale ? `Data as of ${asOf} (last refresh failed — showing last-known-good snapshot)` : `Data as of ${asOf}`;
    const result = await this.reportPdf.render({
      title,
      generatedAt: new Date().toISOString(),
      subtitle,
      headers: rowSet.headers,
      rows: rowSet.rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))),
    });
    return { bytes: Buffer.from(result.bytes), contentType: "application/pdf", rowCount: rowSet.rows.length };
  }

  // ─── Entity-list generators — bounded-page streaming (AC-33) ────────────────

  private async generateStudents(tenantId: string, params: ExportStudentsParams): Promise<GeneratedFile> {
    const writer = new IncrementalCsvWriter([...STUDENTS_EXPORT_HEADERS]);
    let page = 1;
    for (; page <= MAX_PAGES; page++) {
      const result = await this.studentsService.list(tenantId, { ...params, page, pageSize: PAGE_SIZE });
      writer.appendRows(result.items.map(studentExportRow));
      if (!result.meta.hasMore) break;
    }
    return { bytes: writer.toBuffer(), contentType: "text/csv", rowCount: writer.rowCount };
  }

  private async generateLeads(tenantId: string, params: ExportLeadsParams): Promise<GeneratedFile> {
    const writer = new IncrementalCsvWriter([...LEADS_EXPORT_HEADERS]);
    let page = 1;
    for (; page <= MAX_PAGES; page++) {
      const result = await this.leadsService.list(tenantId, { ...params, page, pageSize: PAGE_SIZE });
      writer.appendRows(result.items.map(leadExportRow));
      if (!result.meta.hasMore) break;
    }
    return { bytes: writer.toBuffer(), contentType: "text/csv", rowCount: writer.rowCount };
  }

  private async generatePayments(tenantId: string, params: ExportPaymentsParams): Promise<GeneratedFile> {
    const scope = requireScopeContext();
    const writer = new IncrementalCsvWriter([...PAYMENTS_EXPORT_HEADERS]);
    let page = 1;
    for (; page <= MAX_PAGES; page++) {
      const result = await this.commerceService.listPayments(tenantId, scope.actorId, { ...params, page, pageSize: PAGE_SIZE });
      writer.appendRows(result.items.map(paymentExportRow));
      if (!result.meta.hasMore) break;
    }
    return { bytes: writer.toBuffer(), contentType: "text/csv", rowCount: writer.rowCount };
  }

  private async generateCampaignAudience(tenantId: string, campaignId: string): Promise<GeneratedFile> {
    const writer = new IncrementalCsvWriter([...CAMPAIGN_AUDIENCE_EXPORT_HEADERS]);
    let page = 1;
    for (; page <= MAX_PAGES; page++) {
      const result = await this.campaignsService.listRecipients(tenantId, campaignId, { page, pageSize: PAGE_SIZE });
      const rows = await Promise.all(
        result.items.map((recipient) => this.enrichCampaignRecipient(tenantId, recipient)),
      );
      writer.appendRows(rows.map(campaignAudienceExportRow));
      if (!result.meta.hasMore) break;
    }
    return { bytes: writer.toBuffer(), contentType: "text/csv", rowCount: writer.rowCount };
  }

  /** Enriches a bare campaign_recipients row with display fields — column allowlist per AC-31. */
  private async enrichCampaignRecipient(
    tenantId: string,
    recipient: { leadId: string | null; studentId: string | null; to: string; status: string },
  ): Promise<CampaignAudienceExportRow> {
    if (recipient.leadId) {
      const lead = await this.leadsRepository.findById(tenantId, recipient.leadId, {});
      return {
        name: lead?.name ?? "Unknown",
        email: lead?.email ?? (recipient.to.includes("@") ? recipient.to : null),
        phone: lead?.phone ?? (recipient.to.includes("@") ? null : recipient.to),
        source: lead?.source ?? null,
        stageOrStatus: lead?.stage ?? recipient.status,
        programInterest: lead?.programInterestTitle ?? null,
      };
    }
    if (recipient.studentId) {
      const student = await this.studentsRepository.findById(tenantId, recipient.studentId);
      return {
        name: student?.name ?? "Unknown",
        email: student?.email ?? (recipient.to.includes("@") ? recipient.to : null),
        phone: student?.phone ?? (recipient.to.includes("@") ? null : recipient.to),
        source: "student",
        stageOrStatus: student?.status ?? recipient.status,
        programInterest: null,
      };
    }
    // Neither leadId nor studentId (should not happen — every recipient is materialized
    // from a lead or a student segment query) — degrade gracefully rather than throw.
    return {
      name: "Unknown",
      email: recipient.to.includes("@") ? recipient.to : null,
      phone: recipient.to.includes("@") ? null : recipient.to,
      source: null,
      stageOrStatus: recipient.status,
      programInterest: null,
    };
  }
}
