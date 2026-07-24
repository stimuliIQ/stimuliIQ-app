// apps/api/src/modules/growth/lead-forms.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   LeadFormsController       — /crm/lead-forms admin CRUD (lead_forms.view/edit).
//   PublicLeadFormsController — /public/lead-forms/:key anonymous config read (active
//                               only; actual lead capture stays on POST /public/leads).

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
import type {
  CreateLeadFormRequest,
  LeadForm,
  ListLeadFormsQuery,
  PublicLeadForm,
  UpdateLeadFormRequest,
} from "@repo/types";
import { CreateLeadFormRequestSchema, ListLeadFormsQuerySchema, UpdateLeadFormRequestSchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { LeadFormsService } from "./lead-forms.service";

@Controller("crm/lead-forms")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LeadFormsController {
  constructor(private readonly service: LeadFormsService) {}

  @Get()
  @RequirePermission("lead_forms.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListLeadFormsQuerySchema)) query: ListLeadFormsQuery,
  ): Promise<PaginatedResult<LeadForm>> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("lead_forms.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<LeadForm> {
    return this.service.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("lead_forms.edit")
  @UsePipes(new ZodValidationPipe(CreateLeadFormRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateLeadFormRequest): Promise<LeadForm> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("lead_forms.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateLeadFormRequestSchema)) body: UpdateLeadFormRequest,
  ): Promise<LeadForm> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("lead_forms.edit")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public config read — NO guards, NO auth, CSRF-excluded via app.module.ts
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/lead-forms")
export class PublicLeadFormsController {
  constructor(private readonly service: LeadFormsService) {}

  @Get(":key")
  async getByKey(@Param("key") key: string): Promise<PublicLeadForm> {
    return this.service.getPublicByKey(key);
  }
}
