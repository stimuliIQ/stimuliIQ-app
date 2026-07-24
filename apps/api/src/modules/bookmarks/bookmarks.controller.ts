// apps/api/src/modules/bookmarks/bookmarks.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/me/bookmarks — own-scope only (a student manages ONLY their own
// bookmarks; userId is always taken from the authenticated session, never the body).
//
// ROUTE MAP:
//   POST   /me/bookmarks       — create a bookmark
//   GET    /me/bookmarks       — list own bookmarks (optional refType filter)
//   DELETE /me/bookmarks/:id   — remove own bookmark (IDOR -> 404)
//
// Permission: bookmarks.manage (scope: own — granted to `student` role only, prisma/seed.ts).

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
  UseInterceptors,
} from "@nestjs/common";
import type { Bookmark } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { BookmarksService } from "./bookmarks.service";
import {
  CreateBookmarkRequestSchema,
  type CreateBookmarkRequest,
  ListBookmarksQuerySchema,
  type ListBookmarksQuery,
} from "./dto";

@Controller("me/bookmarks")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BookmarksController {
  constructor(private readonly service: BookmarksService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission("bookmarks.manage")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateBookmarkRequestSchema)) body: CreateBookmarkRequest,
  ): Promise<Bookmark> {
    return this.service.create(user.tenantId, user.id, body);
  }

  @Get()
  @RequirePermission("bookmarks.manage")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListBookmarksQuerySchema)) query: ListBookmarksQuery,
  ): Promise<PaginatedResult<Bookmark>> {
    return this.service.list(user.tenantId, user.id, query);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("bookmarks.manage")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<void> {
    await this.service.remove(user.tenantId, user.id, id);
  }
}
