// apps/api/src/modules/content/partners.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   PartnersController       — /crm/partners admin CRUD.
//   PublicPartnersController — /public/partners anonymous read (published only).

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
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { PartnersService } from "./partners.service";
import {
  CreatePartnerRequestSchema,
  type CreatePartnerRequest,
  UpdatePartnerRequestSchema,
  type UpdatePartnerRequest,
  ListPartnersQuerySchema,
  type ListPartnersQuery,
  type Partner,
  type PublicPartner,
} from "./dto";

@Controller("crm/partners")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class PartnersController {
  constructor(private readonly service: PartnersService) {}

  @Get()
  @RequirePermission("content.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListPartnersQuerySchema)) query: ListPartnersQuery,
  ): Promise<PaginatedResult<Partner>> {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("content.create")
  @UsePipes(new ZodValidationPipe(CreatePartnerRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreatePartnerRequest): Promise<Partner> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("content.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdatePartnerRequestSchema)) body: UpdatePartnerRequest,
  ): Promise<Partner> {
    return this.service.update(user.tenantId, id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("content.publish")
  async publish(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<Partner> {
    return this.service.publish(user.tenantId, id);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("content.delete")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

@Controller("public/partners")
export class PublicPartnersController {
  constructor(private readonly service: PartnersService) {}

  @Get()
  async list(@Query("category") category?: string): Promise<PublicPartner[]> {
    return this.service.listPublic(category);
  }
}
