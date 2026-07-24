// apps/api/src/modules/leads/leads.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/leads (matches @repo/api-client's LeadsApi paths exactly).
// Permission keys match the seeded P2 catalog exactly (prisma/seed.ts P2_MODULES=
// ["leads",...], P2_ACTIONS includes "convert"): leads.view/create/edit/delete/convert.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import type { LeadDetail, LeadSummary, ConvertLeadResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { LeadsService } from "./leads.service";
import {
  CreateLeadRequestSchema,
  type CreateLeadRequest,
  UpdateLeadRequestSchema,
  type UpdateLeadRequest,
  ListLeadsQuerySchema,
  type ListLeadsQuery,
  MoveLeadStageRequestSchema,
  type MoveLeadStageRequest,
  AssignLeadOwnerRequestSchema,
  type AssignLeadOwnerRequest,
  ConvertLeadRequestSchema,
  type ConvertLeadRequest,
} from "./dto";

@Controller("crm/leads")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @RequirePermission("leads.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListLeadsQuerySchema)) query: ListLeadsQuery,
  ): Promise<PaginatedResult<LeadSummary>> {
    return this.leadsService.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("leads.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<LeadDetail> {
    return this.leadsService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("leads.create")
  @UsePipes(new ZodValidationPipe(CreateLeadRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateLeadRequest): Promise<LeadDetail> {
    return this.leadsService.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("leads.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateLeadRequestSchema)) body: UpdateLeadRequest,
  ): Promise<LeadDetail> {
    return this.leadsService.update(user.tenantId, id, body);
  }

  @Patch(":id/stage")
  @RequirePermission("leads.edit")
  async moveStage(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(MoveLeadStageRequestSchema)) body: MoveLeadStageRequest,
  ): Promise<LeadDetail> {
    return this.leadsService.moveStage(user.tenantId, id, body);
  }

  @Patch(":id/owner")
  @RequirePermission("leads.edit")
  async assignOwner(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AssignLeadOwnerRequestSchema)) body: AssignLeadOwnerRequest,
  ): Promise<LeadDetail> {
    return this.leadsService.assignOwner(user.tenantId, id, body);
  }

  @Post(":id/convert")
  @HttpCode(200)
  @RequirePermission("leads.convert")
  async convert(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ConvertLeadRequestSchema)) body: ConvertLeadRequest,
  ): Promise<ConvertLeadResponse> {
    return this.leadsService.convert(user.tenantId, user.id, id, body);
  }

  @Delete(":id")
  @RequirePermission("leads.delete")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<LeadDetail> {
    return this.leadsService.softDelete(user.tenantId, id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermission("leads.edit")
  async restore(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<LeadDetail> {
    return this.leadsService.restore(user.tenantId, id);
  }
}
