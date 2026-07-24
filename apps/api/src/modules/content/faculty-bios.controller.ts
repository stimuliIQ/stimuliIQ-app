// apps/api/src/modules/content/faculty-bios.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   FacultyBiosController       — /crm/faculty-bios admin CRUD.
//   PublicFacultyBiosController — /public/faculty-bios anonymous read (published only).

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
import { FacultyBiosService } from "./faculty-bios.service";
import {
  CreateFacultyBioRequestSchema,
  type CreateFacultyBioRequest,
  UpdateFacultyBioRequestSchema,
  type UpdateFacultyBioRequest,
  ListFacultyBiosQuerySchema,
  type ListFacultyBiosQuery,
  type FacultyBio,
  type PublicFacultyBio,
} from "./dto";

@Controller("crm/faculty-bios")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class FacultyBiosController {
  constructor(private readonly service: FacultyBiosService) {}

  @Get()
  @RequirePermission("content.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListFacultyBiosQuerySchema)) query: ListFacultyBiosQuery,
  ): Promise<PaginatedResult<FacultyBio>> {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("content.create")
  @UsePipes(new ZodValidationPipe(CreateFacultyBioRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateFacultyBioRequest): Promise<FacultyBio> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("content.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateFacultyBioRequestSchema)) body: UpdateFacultyBioRequest,
  ): Promise<FacultyBio> {
    return this.service.update(user.tenantId, id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("content.publish")
  async publish(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<FacultyBio> {
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

@Controller("public/faculty-bios")
export class PublicFacultyBiosController {
  constructor(private readonly service: FacultyBiosService) {}

  @Get()
  async list(): Promise<PublicFacultyBio[]> {
    return this.service.listPublic();
  }
}
