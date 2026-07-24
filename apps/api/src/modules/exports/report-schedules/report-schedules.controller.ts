// apps/api/src/modules/exports/report-schedules/report-schedules.controller.ts
//
// HTTP boundary for recurring report-email schedules (docs/plans/phase-7.md Wave 2
// task #11, docs/specs/phase-7-analytics-hardening.md WS-B). CLAUDE.md §3.3: "controller
// — HTTP boundary, validates DTO via the global Zod pipe, returns DTO. No Prisma / no
// business logic in controllers."
//
// Route map (all require `reports.schedule` — a new permission, DISTINCT from
// `reports.export`, gating the CRUD surface for recurring dispatch; the per-type
// additional view-permission check lives in ReportSchedulesService.assertCanScheduleType):
//   POST   /crm/reports/schedules       reports.schedule
//   GET    /crm/reports/schedules       reports.schedule
//   GET    /crm/reports/schedules/:id   reports.schedule
//   PATCH  /crm/reports/schedules/:id   reports.schedule
//   DELETE /crm/reports/schedules/:id   reports.schedule

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type {
  CreateReportScheduleDto,
  ReportScheduleDto,
  UpdateReportScheduleDto,
  ListReportSchedulesQuery,
} from "@repo/types";
import { CreateReportScheduleDtoSchema, UpdateReportScheduleDtoSchema, ListReportSchedulesQuerySchema } from "@repo/types";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { RequestUser } from "../../auth/lib/request-user";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../../common/dto/paginated-result";
import { ReportSchedulesService } from "./report-schedules.service";

@Controller("crm/reports/schedules")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class ReportSchedulesController {
  constructor(private readonly service: ReportSchedulesService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission("reports.schedule")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateReportScheduleDtoSchema)) body: CreateReportScheduleDto,
  ): Promise<ReportScheduleDto> {
    return this.service.create(user.tenantId, user, body);
  }

  @Get()
  @RequirePermission("reports.schedule")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListReportSchedulesQuerySchema)) query: ListReportSchedulesQuery,
  ): Promise<PaginatedResult<ReportScheduleDto>> {
    return this.service.list(user.tenantId, user, query);
  }

  @Get(":id")
  @RequirePermission("reports.schedule")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReportScheduleDto> {
    return this.service.getById(user.tenantId, user, id);
  }

  @Patch(":id")
  @RequirePermission("reports.schedule")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateReportScheduleDtoSchema)) body: UpdateReportScheduleDto,
  ): Promise<ReportScheduleDto> {
    return this.service.update(user.tenantId, user, id, body);
  }

  @Delete(":id")
  @RequirePermission("reports.schedule")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReportScheduleDto> {
    return this.service.remove(user.tenantId, user, id);
  }
}
