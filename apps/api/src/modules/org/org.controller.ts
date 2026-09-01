// apps/api/src/modules/org/org.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). `/api/v1/crm/org`.
//
// PERMISSION SPLIT, deliberately asymmetric (docs/specs/org-teams.md):
//   - READING the org chart is gated on `org.teams.view`, which lives INSIDE the seed's
//     permission catalog. Knowing who your lead is is information, not authority, and a key
//     held outside the catalog would have to be remembered for every role that ever needs a
//     team picker — the `course_types.view` argument from P16.
//   - WRITING is gated on `org.teams.manage`, seeded OUTSIDE the catalog so `admin` does not
//     inherit it. This is the security keystone of the whole phase: because the hierarchy is
//     data and the approval rule is uniform, WHOEVER CAN EDIT TEAMS DECIDES WHO APPROVES
//     WHOSE LEAVE. That is authority equivalent to `leave.approve`, so it is narrowed by the
//     same device (a dedicated block outside the admin catch-all in prisma/seed.ts).
//   - `GET /me/position` needs no permission beyond being signed in: it takes NO user id at
//     all and answers only about the caller, so there is nothing to tamper with — the same
//     structural own-scope as `/crm/marketing-targets/me` (P15).

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
  Put,
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

import { OrgService } from "./org.service";
import {
  ListTeamsQuerySchema,
  type ListTeamsQuery,
  CreateTeamRequestSchema,
  type CreateTeamRequest,
  UpdateTeamRequestSchema,
  type UpdateTeamRequest,
  SetTeamMembersRequestSchema,
  type SetTeamMembersRequest,
  type Team,
  type TeamDetail,
  type MyOrgPosition,
} from "./dto";

@Controller("crm/org")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class OrgController {
  constructor(private readonly service: OrgService) {}

  @Get("teams")
  @RequirePermission("org.teams.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListTeamsQuerySchema)) query: ListTeamsQuery,
  ): Promise<PaginatedResult<Team>> {
    return this.service.list(user.tenantId, query);
  }

  /**
   * The staff pool for the manager / lead / member pickers. Behind `org.teams.view` rather
   * than `users.view`: choosing a team lead needs names, not the staff directory's contact
   * details and account status, and requiring `users.view` here would mean anyone who may
   * read the org chart must also be trusted with the whole user admin surface.
   */
  @Get("staff")
  @RequirePermission("org.teams.view")
  async staff(@CurrentUser() user: RequestUser) {
    return this.service.listAssignableStaff(user.tenantId);
  }

  @Get("teams/:id")
  @RequirePermission("org.teams.view")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<TeamDetail> {
    return this.service.get(user.tenantId, id);
  }

  @Post("teams")
  @HttpCode(201)
  @RequirePermission("org.teams.manage")
  @UsePipes(new ZodValidationPipe(CreateTeamRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateTeamRequest): Promise<Team> {
    return this.service.create(user.tenantId, body);
  }

  @Patch("teams/:id")
  @RequirePermission("org.teams.manage")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateTeamRequestSchema)) body: UpdateTeamRequest,
  ): Promise<Team> {
    return this.service.update(user.tenantId, id, body);
  }

  @Put("teams/:id/members")
  @RequirePermission("org.teams.manage")
  async setMembers(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SetTeamMembersRequestSchema)) body: SetTeamMembersRequest,
  ): Promise<TeamDetail> {
    return this.service.setMembers(user.tenantId, id, body);
  }

  @Delete("teams/:id")
  @HttpCode(204)
  @RequirePermission("org.teams.manage")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.service.remove(user.tenantId, id);
  }

  /**
   * Where the signed-in person sits, and who signs off their leave. Takes no user id, so
   * scope is structural — there is no parameter to tamper with and therefore no IDOR
   * surface. Every signed-in member of staff may read their own position; being told who
   * your own manager is is not a privilege.
   */
  @Get("me/position")
  async myPosition(@CurrentUser() user: RequestUser): Promise<MyOrgPosition> {
    return this.service.getPosition(user.tenantId, user.id);
  }
}
