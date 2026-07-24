// apps/api/src/modules/bulk-actions/saved-views.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/saved-views — own-scope only (a staff user manages ONLY their
// own saved filter sets; userId is always taken from the authenticated session).
//
// PERMISSION NOTE: no dedicated `saved_views.*` key exists in the Wave-1 permission
// catalog for this task (only `bookmarks.manage`/`notes.manage`/`search.use`/
// `bulk.leads`/`bulk.students` were seeded for T29/T30 — see prisma/seed.ts). A saved
// view is an opaque, per-user named filter-set (never interpreted server-side — see
// bulk-actions.schemas.ts) over data the caller must ALREADY separately hold
// `leads.view`/`students.view` to actually query; it carries no additional data-access
// surface of its own. Per `PermissionsGuard`'s own documented convention ("Routes with
// no @RequirePermission metadata are allowed through — authentication-only, e.g. /me"),
// this controller relies on JwtAuthGuard (authentication) + own-scope enforcement in the
// service (never a client-supplied userId) rather than a new permission key.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { SavedViewsService } from "./saved-views.service";
import {
  CreateSavedViewRequestSchema,
  type CreateSavedViewRequest,
  ListSavedViewsQuerySchema,
  type ListSavedViewsQuery,
  type SavedView,
} from "./dto";

@Controller("crm/saved-views")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SavedViewsController {
  constructor(private readonly service: SavedViewsService) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateSavedViewRequestSchema)) body: CreateSavedViewRequest,
  ): Promise<SavedView> {
    return this.service.create(user.tenantId, user.id, body);
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListSavedViewsQuerySchema)) query: ListSavedViewsQuery,
  ): Promise<SavedView[]> {
    return this.service.list(user.tenantId, user.id, query);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<void> {
    await this.service.remove(user.tenantId, user.id, id);
  }
}
