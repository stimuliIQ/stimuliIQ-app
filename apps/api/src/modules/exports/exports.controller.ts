// apps/api/src/modules/exports/exports.controller.ts
//
// HTTP boundary for on-demand CSV/PDF exports (docs/plans/phase-7.md task #8,
// docs/specs/phase-7-analytics-hardening.md WS-B). CLAUDE.md §3.3: "controller — HTTP
// boundary, validates DTO via the global Zod pipe, returns DTO. No Prisma / no business
// logic in controllers."
//
// Route map (all require `reports.export` — AC-34's SEPARATE export permission; the
// per-type additional view-permission check lives in ExportsService.assertCanExportType):
//   POST /crm/exports        reports.export   — create + (sync-seam) run an export job
//   GET  /crm/exports        reports.export   — list own+scoped export history
//   GET  /crm/exports/:id    reports.export   — job status + signed downloadUrl

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { CreateExportRequestDto, ExportJobDto, ListExportJobsQuery } from "@repo/types";
import { CreateExportRequestDtoSchema, ListExportJobsQuerySchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { ExportsService } from "./exports.service";

@Controller("crm/exports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class ExportsController {
  constructor(private readonly service: ExportsService) {}

  /** POST /api/v1/crm/exports — creates and (sync-seam) runs an export job. 202 per the OpenAPI contract (openapi/registry.ts) — semantically "accepted", forward-compatible with a future async/BullMQ worker even though generation currently completes inline. */
  @Post()
  @HttpCode(202)
  @RequirePermission("reports.export")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateExportRequestDtoSchema)) body: CreateExportRequestDto,
  ): Promise<ExportJobDto> {
    return this.service.create(user.tenantId, user, body);
  }

  /** GET /api/v1/crm/exports — own+scoped export history, paginated. */
  @Get()
  @RequirePermission("reports.export")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListExportJobsQuerySchema)) query: ListExportJobsQuery,
  ): Promise<PaginatedResult<ExportJobDto>> {
    return this.service.list(user.tenantId, user, query);
  }

  /** GET /api/v1/crm/exports/:id — job status + signed downloadUrl once succeeded. */
  @Get(":id")
  @RequirePermission("reports.export")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ExportJobDto> {
    return this.service.getById(user.tenantId, user, id);
  }
}
