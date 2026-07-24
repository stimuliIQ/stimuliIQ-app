// apps/api/src/modules/exports/report-schedules/report-schedules.module.ts
//
// ReportSchedulesModule — recurring report-email schedules (docs/plans/phase-7.md
// Wave 2 task #11, docs/specs/phase-7-analytics-hardening.md WS-B).
//
// Layering (CLAUDE.md §3.3):
//   ReportSchedulesController      — CRUD HTTP boundary (RBAC: reports.schedule)
//   ReportSchedulesService         — schedule-definition CRUD, permission gating
//   ReportSchedulesRepository      — Prisma data access (report_schedules) + the
//                                    optimistic-concurrency claim used by the dispatch
//                                    cron
//   ReportScheduleDispatchScheduler — cron: finds due schedules, re-evaluates the
//                                    creator's CURRENT scope (AC-37), generates via
//                                    ExportsService, sends via MailProvider
//
// Imports:
//   AuthModule           — JwtAuthGuard, PermissionsGuard, ScopeInterceptor, AuthRepository
//                          (the dispatch cron's AC-37 fresh-permission lookup)
//   ExportsModule        — ExportsService (the SAME sync-seam the on-demand export
//                          endpoint uses — Rule H-2, no separate/duplicated generation path)
//   NotificationsModule  — NotificationsRepository (suppression check reuse, Rule C-2)
//   MailProviderModule   — MAIL_PROVIDER (report email delivery)

import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { ExportsModule } from "../exports.module";
import { NotificationsModule } from "../../notifications/notifications.module";
import { MailProviderModule } from "../../notifications/providers/mail/mail-provider.module";
import { ReportSchedulesController } from "./report-schedules.controller";
import { ReportSchedulesService } from "./report-schedules.service";
import { ReportSchedulesRepository } from "./report-schedules.repository";
import { ReportScheduleDispatchScheduler } from "./report-schedules.dispatch.scheduler";

@Module({
  imports: [AuthModule, ExportsModule, NotificationsModule, MailProviderModule],
  controllers: [ReportSchedulesController],
  providers: [ReportSchedulesService, ReportSchedulesRepository, ReportScheduleDispatchScheduler],
  exports: [ReportSchedulesService],
})
export class ReportSchedulesModule {}
