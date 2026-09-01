// apps/api/src/modules/analytics/analytics.module.ts
//
// AnalyticsModule — Phase 7 KPI dashboards (docs/plans/phase-7.md task #7).
//
// Layering (CLAUDE.md §3.3):
//   AnalyticsController — HTTP boundary, RBAC (all-scope-aware routes)
//   AnalyticsService     — scope resolution, 422 date-range guard, freshness assembly,
//                          Redis cache-aside
//   AnalyticsRepository  — parameterized raw-SQL reads of the eight Phase-7 materialized
//                          views + Prisma lookups (program/batch/user names)
//
// Imports:
//   AuthModule     — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   CampaignsModule — CampaignsService (the campaign-performance dashboard's deliberate
//                     LOCK-D1 exception — reads the live campaigns.metrics cache instead
//                     of the campaign-performance MV, see analytics.repository.ts header)
// RedisModule is @Global — RedisService is available without an explicit import.

import { Module } from "@nestjs/common";
import { OrgModule } from "../org/org.module";
import { AuthModule } from "../auth/auth.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsRepository } from "./analytics.repository";
import { AnalyticsMvRefreshScheduler } from "./mv-refresh.scheduler";

@Module({
  imports: [AuthModule, CampaignsModule, OrgModule],
  controllers: [AnalyticsController],
  // AnalyticsMvRefreshScheduler (Wave 2 task #11) depends on `SchedulerRegistry`, provided
  // globally by `ScheduleModule.forRoot()` in app.module.ts — no explicit import needed
  // here (NestJS `@Global()` dynamic module semantics).
  providers: [AnalyticsService, AnalyticsRepository, AnalyticsMvRefreshScheduler],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
