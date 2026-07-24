// apps/api/src/modules/analytics/analytics.controller.ts
//
// HTTP boundary for the Phase-7 KPI dashboards (docs/plans/phase-7.md task #7,
// docs/specs/phase-7-analytics-hardening.md WS-A). CLAUDE.md §3.3: "controller — HTTP
// boundary, validates DTO via the global Zod pipe, returns DTO. No Prisma / no business
// logic in controllers." Every route: JwtAuthGuard + PermissionsGuard + ScopeInterceptor,
// mirroring every other CRM module (forum/campaigns/leads).
//
// Route map (permission key, scope per docs/specs/phase-7-analytics-hardening.md Part 8):
//   GET /crm/reports/revenue       reports.revenue.view       (all|branch)
//   GET /crm/reports/enrollments   reports.enrollment.view    (all|branch|assigned)
//   GET /crm/reports/funnel        reports.funnel.view        (all|branch|own)
//   GET /crm/reports/attendance    reports.attendance.view    (all|branch|assigned)
//   GET /crm/reports/engagement    reports.engagement.view    (all|branch|assigned)
//   GET /crm/reports/campaigns     reports.campaigns.view     (all — reuses campaigns.view grants)
//   GET /crm/reports/gamification  reports.gamification.view  (all|assigned)
//   GET /crm/reports/forum-health  reports.forum.view         (all|assigned)
//
// Health/readiness endpoints and reports/exports (CSV/PDF, schedules) are explicitly OUT
// of this controller's scope — separate tasks (docs/plans/phase-7.md #8, #9).

import { Controller, Get, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type {
  RevenueReportQuery,
  RevenueReportDto,
  EnrollmentTrendQuery,
  EnrollmentTrendDto,
  FunnelReportQuery,
  FunnelReportDto,
  AttendanceReportQuery,
  AttendanceReportDto,
  EngagementReportQuery,
  EngagementReportDto,
  CampaignPerformanceQuery,
  CampaignPerformanceDto,
  GamificationParticipationQuery,
  GamificationParticipationDto,
  ForumHealthReportQuery,
  ForumHealthReportDto,
} from "@repo/types";
import {
  RevenueReportQuerySchema,
  EnrollmentTrendQuerySchema,
  FunnelReportQuerySchema,
  AttendanceReportQuerySchema,
  EngagementReportQuerySchema,
  CampaignPerformanceQuerySchema,
  GamificationParticipationQuerySchema,
  ForumHealthReportQuerySchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AnalyticsService } from "./analytics.service";

@Controller("crm/reports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  /** GET /api/v1/crm/reports/revenue — AC-1..AC-6. */
  @Get("revenue")
  @RequirePermission("reports.revenue.view")
  async getRevenue(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(RevenueReportQuerySchema)) query: RevenueReportQuery,
  ): Promise<RevenueReportDto> {
    return this.service.getRevenue(user.tenantId, query);
  }

  /** GET /api/v1/crm/reports/enrollments — AC-7..AC-9. */
  @Get("enrollments")
  @RequirePermission("reports.enrollment.view")
  async getEnrollmentTrend(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(EnrollmentTrendQuerySchema)) query: EnrollmentTrendQuery,
  ): Promise<EnrollmentTrendDto> {
    return this.service.getEnrollmentTrend(user.tenantId, query);
  }

  /** GET /api/v1/crm/reports/funnel — AC-10..AC-13. */
  @Get("funnel")
  @RequirePermission("reports.funnel.view")
  async getFunnel(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(FunnelReportQuerySchema)) query: FunnelReportQuery,
  ): Promise<FunnelReportDto> {
    return this.service.getFunnel(user.tenantId, query);
  }

  /** GET /api/v1/crm/reports/attendance — AC-14..AC-16. */
  @Get("attendance")
  @RequirePermission("reports.attendance.view")
  async getAttendance(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(AttendanceReportQuerySchema)) query: AttendanceReportQuery,
  ): Promise<AttendanceReportDto> {
    return this.service.getAttendance(user.tenantId, query);
  }

  /** GET /api/v1/crm/reports/engagement — AC-17..AC-19. */
  @Get("engagement")
  @RequirePermission("reports.engagement.view")
  async getEngagement(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(EngagementReportQuerySchema)) query: EngagementReportQuery,
  ): Promise<EngagementReportDto> {
    return this.service.getEngagement(user.tenantId, query);
  }

  /** GET /api/v1/crm/reports/campaigns — AC-20..AC-22. */
  @Get("campaigns")
  @RequirePermission("reports.campaigns.view")
  async getCampaignPerformance(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(CampaignPerformanceQuerySchema)) query: CampaignPerformanceQuery,
  ): Promise<CampaignPerformanceDto> {
    return this.service.getCampaignPerformance(user.tenantId, query);
  }

  /** GET /api/v1/crm/reports/gamification — AC-23..AC-25 (staff-facing; MAY carry PII). */
  @Get("gamification")
  @RequirePermission("reports.gamification.view")
  async getGamificationParticipation(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(GamificationParticipationQuerySchema)) query: GamificationParticipationQuery,
  ): Promise<GamificationParticipationDto> {
    return this.service.getGamificationParticipation(user.tenantId, query);
  }

  /** GET /api/v1/crm/reports/forum-health — AC-26..AC-27. */
  @Get("forum-health")
  @RequirePermission("reports.forum.view")
  async getForumHealth(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ForumHealthReportQuerySchema)) query: ForumHealthReportQuery,
  ): Promise<ForumHealthReportDto> {
    return this.service.getForumHealth(user.tenantId, query);
  }
}
