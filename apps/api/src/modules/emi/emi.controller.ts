// apps/api/src/modules/emi/emi.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes:
//   CrmEmiController — staff (/crm/emi-plans*), JwtAuthGuard + PermissionsGuard.
//   MyEmiController  — student self-view (/me/emi-plans), JwtAuthGuard + PermissionsGuard.

import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { EmiPlanDetail, EmiPlanSummary } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { EmiService } from "./emi.service";
import {
  CreateEmiPlanRequestSchema,
  type CreateEmiPlanRequest,
  ListEmiPlansQuerySchema,
  type ListEmiPlansQuery,
  MarkEmiInstallmentPaidRequestSchema,
  type MarkEmiInstallmentPaidRequest,
  TriggerEmiDunningRequestSchema,
  type TriggerEmiDunningRequest,
} from "./dto";

@Controller("crm/emi-plans")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CrmEmiController {
  constructor(private readonly service: EmiService) {}

  @Get()
  @RequirePermission("emi.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListEmiPlansQuerySchema)) query: ListEmiPlansQuery,
  ): Promise<PaginatedResult<EmiPlanSummary>> {
    return this.service.listCrm(user.tenantId, user.id, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("emi.create")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateEmiPlanRequestSchema)) body: CreateEmiPlanRequest,
  ): Promise<EmiPlanDetail> {
    return this.service.createPlan(user.tenantId, body);
  }

  @Get(":id")
  @RequirePermission("emi.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<EmiPlanDetail> {
    return this.service.getById(user.tenantId, id);
  }

  @Post(":id/installments/:installmentId/mark-paid")
  @HttpCode(200)
  @RequirePermission("emi.charge")
  async markPaid(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("installmentId", new ParseUUIDPipe()) installmentId: string,
    @Body(new ZodValidationPipe(MarkEmiInstallmentPaidRequestSchema)) body: MarkEmiInstallmentPaidRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<EmiPlanDetail> {
    return this.service.markInstallmentPaid(user.tenantId, id, installmentId, body, idempotencyKey ?? randomUUID());
  }

  @Post(":id/installments/:installmentId/dunning")
  @HttpCode(200)
  @RequirePermission("emi.edit")
  async triggerDunning(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("installmentId", new ParseUUIDPipe()) installmentId: string,
    @Body(new ZodValidationPipe(TriggerEmiDunningRequestSchema)) _body: TriggerEmiDunningRequest,
  ): Promise<EmiPlanDetail> {
    return this.service.triggerDunning(user.tenantId, id, installmentId);
  }
}

@Controller("me/emi-plans")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MyEmiController {
  constructor(private readonly service: EmiService) {}

  @Get()
  @RequirePermission("emi.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListEmiPlansQuerySchema)) query: ListEmiPlansQuery,
  ): Promise<PaginatedResult<EmiPlanSummary>> {
    return this.service.listOwn(user.tenantId, user.id, query);
  }
}
