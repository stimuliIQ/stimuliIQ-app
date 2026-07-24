// apps/api/src/modules/exports/report-schedules/report-schedules.dispatch.scheduler.ts
//
// Scheduled dispatch of due recurring report emails (docs/plans/phase-7.md Wave 2
// task #11, docs/specs/phase-7-analytics-hardening.md WS-B AC-37/38/39).
//
// ─── AC-37 (HEADLINE): scope is re-evaluated at SEND time, never a stale snapshot ──────
//
// This is the ENTIRE reason `report_schedules` carries no scope/branch/assigned column
// (see the Prisma model's doc comment). On every due schedule, this scheduler:
//   1. Fetches the creator's CURRENT permission grants fresh from the DB
//      (`AuthRepository.getRbacProfile` — the exact same query the login/session-refresh
//      path uses; never a cached/stored value).
//   2. Confirms the creator STILL holds `reports.export` (the same permission that gates
//      the on-demand export route) AND the domain-specific view permission for this
//      report `type` (`TYPE_VIEW_PERMISSION`, shared with ExportsService/
//      ReportSchedulesService). If either is missing, the run is SKIPPED and the schedule
//      is DEACTIVATED (`active=false`) — per the task brief: "if the creator lost access,
//      skip/deactivate".
//   3. Builds a `ScopeContext` from the CURRENT `reports.export` grant's scope (mirrors
//      `ScopeInterceptor`'s real-request behavior — see ExportsService's file header:
//      "matched against reports.export") and runs `ExportsService.create()` — the EXACT
//      SAME sync-seam the on-demand export endpoint uses — inside that scope. A Branch
//      Manager who was moved from Branch B to Branch C between schedule-creation and this
//      run sees Branch C's data, never a stale Branch B snapshot.
//
// ─── Idempotent single-fire (task brief: "guard against double-send") ─────────────────
//
// `ReportSchedulesRepository.claimDueSchedule()` is an optimistic-concurrency
// compare-and-swap on `next_run_at` — see that method's doc comment. A schedule is only
// ever processed by whichever tick/replica successfully claims it; every other caller
// sees `claimed=false` and skips.
//
// ─── AC-38 (failures logged/surfaced, never silently dropped) ─────────────────────────
//
// Every terminal outcome (succeeded/failed/skipped_suppressed/sent_no_data) is recorded
// on the row via `lastStatus`/`lastError`, visible through GET /crm/reports/schedules —
// an admin-visible failure list. A `MailProvider.send()` failure is additionally logged
// (sanitized — never the raw provider error object, which could carry response headers)
// and left `active=true` so the NEXT due window retries naturally.
//
// ─── AC-39 (empty result handled gracefully) ───────────────────────────────────────────
//
// `rowCount === 0` still generates a valid (header-only) export and STILL sends the
// email, with the subject/body indicating "no data for this period" — recorded as
// `lastStatus = 'sent_no_data'`, distinct from `'succeeded'`.
//
// ─── Edge case: recipient suppressed (Rule C-2 reuse) ──────────────────────────────────
//
// If the resolved recipient email is on `notification_suppressions` for channel=email,
// the send is skipped (never bypassed) and recorded as `lastStatus = 'skipped_suppressed'`.
//
// TEST-SAFETY (CRITICAL): registration gated behind `isSchedulerEnabled()` exactly like
// `AnalyticsMvRefreshScheduler` — see that file's header and config/scheduler.ts.

import { HttpException, Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import type { CreateExportRequestDto, ExportEntityType, ExportFormat } from "@repo/types";
import { validateEnv } from "../../../config/env";
import { isSchedulerEnabled } from "../../../config/scheduler";
import { AuthRepository } from "../../auth/auth.repository";
import { scopeContextStorage, type ScopeContext } from "../../auth/lib/scope-context";
import type { RequestUser } from "../../auth/lib/request-user";
import { NotificationsRepository } from "../../notifications/notifications.repository";
import { MAIL_PROVIDER, type MailProvider } from "../../notifications/providers/mail/mail-provider.interface";
import { ExportsService } from "../exports.service";
import { TYPE_VIEW_PERMISSION } from "../lib/type-view-permission";
import { ReportSchedulesRepository, type ReportScheduleRow } from "./report-schedules.repository";
import { computeNextRunAt } from "./lib/next-run";

const INTERVAL_NAME = "report-schedule-dispatch";
/** Bounded batch size per tick — a defensive ceiling, not an expected steady-state volume. */
const BATCH_LIMIT = 200;

const TYPE_LABELS: Record<string, string> = {
  revenue: "Revenue",
  enrollments: "Enrollment Trend",
  funnel: "Lead Funnel",
  attendance: "Attendance",
  engagement: "Course Engagement",
  campaigns: "Campaign Performance",
  gamification: "Gamification Participation",
  "forum-health": "Forum Health",
};

/**
 * The 8 report-backed types `CreateReportScheduleDtoSchema`'s discriminated union allows
 * (@repo/types crm/exports.schemas.ts) — hardcoded here (rather than importing the zod
 * schema as a runtime value) because `@repo/types` builds as pure ESM, which this
 * project's FAST unit jest.config.js does not map back to source (unlike
 * jest.integration.config.js) — a real (non-type) value import from `@repo/types` inside
 * a file reachable from a fast-suite spec would break the whole fast suite's module
 * resolution (same constraint documented in analytics.service.ts's `ALL_LEAD_STAGES`
 * comment). Used only as a lightweight runtime type-guard (below) over data that was
 * ALREADY zod-validated once, at schedule-creation time (ReportSchedulesController) — this
 * is a defensive "was the stored row corrupted/hand-edited" check, not first-time input
 * validation.
 */
const REPORT_SCHEDULE_TYPES: readonly ExportEntityType[] = [
  "revenue",
  "enrollments",
  "funnel",
  "attendance",
  "engagement",
  "campaigns",
  "gamification",
  "forum-health",
] as const;

function isReportScheduleType(type: string): type is ExportEntityType {
  return (REPORT_SCHEDULE_TYPES as readonly string[]).includes(type);
}

function isExportFormat(format: string): format is ExportFormat {
  return format === "csv" || format === "pdf";
}

@Injectable()
export class ReportScheduleDispatchScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReportScheduleDispatchScheduler.name);

  constructor(
    private readonly repo: ReportSchedulesRepository,
    private readonly authRepository: AuthRepository,
    private readonly notificationsRepository: NotificationsRepository,
    private readonly exportsService: ExportsService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const env = validateEnv();
    if (!isSchedulerEnabled(env)) {
      this.logger.log(
        "[ReportScheduleDispatchScheduler] SCHEDULER_ENABLED is false (or NODE_ENV=test) — " +
          "dispatch interval NOT registered.",
      );
      return;
    }

    const intervalMs = env.REPORT_SCHEDULE_DISPATCH_INTERVAL_MS;
    const timer = setInterval(() => {
      void this.dispatchDueSchedules();
    }, intervalMs);
    timer.unref?.();
    this.schedulerRegistry.addInterval(INTERVAL_NAME, timer);
    this.logger.log(`[ReportScheduleDispatchScheduler] registered — scanning every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.schedulerRegistry.doesExist("interval", INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    }
  }

  /** Public (not private) so tests/a manual "run now" trigger can invoke a full tick directly. */
  async dispatchDueSchedules(): Promise<void> {
    const now = new Date();
    let due: ReportScheduleRow[];
    try {
      due = await this.repo.findDueCandidates(now, BATCH_LIMIT);
    } catch (err) {
      this.logger.error(`[ReportScheduleDispatchScheduler] failed to scan due schedules: ${String(err)}`);
      return;
    }

    for (const schedule of due) {
      // Isolate each schedule's failure — one bad row must never block the rest of the batch.
      try {
        await this.processSchedule(schedule, now);
      } catch (err) {
        this.logger.error(
          `[ReportScheduleDispatchScheduler] unexpected error processing schedule=${schedule.id}: ${String(err)}`,
        );
      }
    }
  }

  /** Processes a single due schedule. Public for direct unit testing without needing to fake a full tick. */
  async processSchedule(schedule: ReportScheduleRow, now: Date): Promise<void> {
    const nextRunAt = computeNextRunAt(schedule.nextRunAt, schedule.frequency);
    const claimed = await this.repo.claimDueSchedule(schedule.id, schedule.nextRunAt, nextRunAt, now);
    if (!claimed) {
      // Another tick/replica already owns this due window — idempotent no-op.
      return;
    }

    // Defensive re-validation of the stored type/format — a corrupted/legacy row must
    // never reach ExportsService with an unrecognized shape. Checked BEFORE the
    // permission lookups below so a corrupted row surfaces its own distinct error rather
    // than being masked as "creator lost the (undefined) view permission". `params`
    // itself was already zod-validated once at schedule-creation time
    // (ReportSchedulesController) against the EXACT SAME query schema the matching
    // on-screen dashboard uses (Rule H-2) and is passed through here as-is —
    // ExportsService/AnalyticsService's own query-schema consumers (e.g. Prisma
    // parameterized queries) are the next real validation boundary.
    if (!isReportScheduleType(schedule.type) || !isExportFormat(schedule.format)) {
      await this.repo.deactivate(
        schedule.id,
        "Stored schedule type/format failed re-validation — schedule deactivated.",
      );
      this.logger.error(
        `[ReportScheduleDispatchScheduler] schedule=${schedule.id} deactivated — unrecognized type="${schedule.type}" format="${schedule.format}".`,
      );
      return;
    }
    const exportRequest = {
      type: schedule.type,
      format: schedule.format,
      params: schedule.params,
    } as CreateExportRequestDto;

    // ─── AC-37: re-evaluate the creator's CURRENT permissions, never a cached value ──
    const { roleKeys, permissions } = await this.authRepository.getRbacProfile(schedule.createdById);

    const exportGrant = permissions.find((p) => p.key === "reports.export");
    if (!exportGrant) {
      await this.repo.deactivate(
        schedule.id,
        'Creator no longer holds the "reports.export" permission — schedule deactivated.',
      );
      this.logger.warn(
        `[ReportScheduleDispatchScheduler] schedule=${schedule.id} deactivated — creator lost reports.export.`,
      );
      return;
    }

    const viewPermissionKey = TYPE_VIEW_PERMISSION[schedule.type];
    const hasView = permissions.some((p) => p.key === viewPermissionKey);
    if (!hasView) {
      await this.repo.deactivate(
        schedule.id,
        `Creator no longer holds the "${viewPermissionKey}" permission required for this report — schedule deactivated.`,
      );
      this.logger.warn(
        `[ReportScheduleDispatchScheduler] schedule=${schedule.id} deactivated — creator lost ${viewPermissionKey}.`,
      );
      return;
    }

    const requestUser: RequestUser = {
      id: schedule.createdById,
      tenantId: schedule.tenantId,
      roles: roleKeys,
      permissions,
      // This scheduler synthesizes a RequestUser purely to reuse the existing scoped
      // service methods (ExportsService et al.) at dispatch time — it is not a live HTTP
      // session, so there is no first-login gate to reflect here.
      mustChangePassword: false,
    };
    // Mirrors the real HTTP export path exactly: the scope context is derived from the
    // `reports.export` grant (see ExportsService's file header) — NOT the domain-view
    // permission's own scope.
    const scopeCtx: ScopeContext = {
      permissionKey: "reports.export",
      scope: exportGrant.scope,
      actorId: schedule.createdById,
      tenantId: schedule.tenantId,
    };

    let rowCount: number | null;
    let downloadUrl: string | null;
    try {
      const exportJob = await scopeContextStorage.run(scopeCtx, () =>
        this.exportsService.create(schedule.tenantId, requestUser, exportRequest),
      );
      if (exportJob.status !== "succeeded") {
        await this.repo.recordRunOutcome(schedule.id, "failed", exportJob.error ?? "Export generation failed.");
        return;
      }
      rowCount = exportJob.rowCount;
      downloadUrl = exportJob.downloadUrl;
    } catch (err) {
      const detail = err instanceof HttpException ? this.sanitizeHttpError(err) : "Export generation failed.";
      await this.repo.recordRunOutcome(schedule.id, "failed", detail);
      return;
    }

    // ─── Resolve recipient (null = creator's own registered email, AC per DTO comment) ──
    let recipientEmail = schedule.recipientEmail;
    if (!recipientEmail) {
      const creator = await this.authRepository.findUserById(schedule.createdById);
      recipientEmail = creator?.email ?? null;
    }
    if (!recipientEmail) {
      await this.repo.recordRunOutcome(
        schedule.id,
        "failed",
        "No recipient email could be resolved for this schedule.",
      );
      return;
    }

    // ─── Suppression (Rule C-2 reuse) ────────────────────────────────────────────
    const suppressed = await this.notificationsRepository.isSuppressed({
      tenantId: schedule.tenantId,
      channel: "email",
      email: recipientEmail,
    });
    if (suppressed) {
      await this.repo.recordRunOutcome(schedule.id, "skipped_suppressed", null);
      return;
    }

    // ─── Send (AC-39: zero-row result still sends, with a "no data" notice) ───────
    const noData = rowCount === 0;
    const label = TYPE_LABELS[schedule.type] ?? schedule.type;
    const subject = noData ? `Your ${label} report — no data for this period` : `Your ${label} report is ready`;
    const html = this.buildEmailHtml(label, noData, downloadUrl);

    try {
      await this.mail.send({ to: recipientEmail, subject, html });
    } catch (err) {
      // AC-38: never silently dropped — logged (sanitized) + surfaced via lastError.
      this.logger.error(
        `[ReportScheduleDispatchScheduler] mail send failed schedule=${schedule.id}: ${this.sanitizeMailError(err)}`,
      );
      await this.repo.recordRunOutcome(
        schedule.id,
        "failed",
        "Email delivery failed. Will be retried at the next scheduled window.",
      );
      return;
    }

    await this.repo.recordRunOutcome(schedule.id, noData ? "sent_no_data" : "succeeded", null);
  }

  private buildEmailHtml(label: string, noData: boolean, downloadUrl: string | null): string {
    if (noData) {
      return (
        `<p>Your scheduled <strong>${label}</strong> report ran for this period, but there was ` +
        `no data to report.</p>`
      );
    }
    const link = downloadUrl
      ? `<p><a href="${downloadUrl}">Download your report</a> (link expires shortly).</p>`
      : `<p>Your report was generated but no download link is currently available — please check the CRM export history.</p>`;
    return `<p>Your scheduled <strong>${label}</strong> report is ready.</p>${link}`;
  }

  /** Never surface a raw stack trace / internal error message — mirrors ExportsService.sanitizeError. */
  private sanitizeHttpError(err: HttpException): string {
    const response = err.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object" && "title" in response) {
      return String((response as { title: unknown }).title);
    }
    return err.message;
  }

  /** Never log a raw provider error object (may carry response headers/auth details). */
  private sanitizeMailError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return "unknown mail provider error";
  }
}
