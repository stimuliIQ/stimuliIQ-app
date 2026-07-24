// apps/api/src/modules/gamification/gamification.controller.ts
//
// HTTP boundary for the GamificationModule (WS-3, docs/plans/phase-6.md task #8).
// (CLAUDE.md §3.3: "controller — HTTP boundary, validates DTO via the global Zod pipe.
// No Prisma / no business logic in controllers.")
//
// ─── ROUTE MAP ────────────────────────────────────────────────────────────────
//   GET /me/gamification            gamification.view (own)   — points + badges + streak
//   PUT /me/gamification/prefs      gamification.view (own)   — leaderboard opt-in/alias
//   GET /batches/:id/leaderboard    gamification.view (enroll)— opt-in, PII-minimal, IDOR→404
//
// SECURITY:
//   - JwtAuthGuard + PermissionsGuard on all routes.
//   - Own-scope: userId always from session (JWT), never client-supplied.
//   - Leaderboard is enrollment-scoped (404 when not enrolled — AC-52) and returns
//     LeaderboardEntryDto only (compile-asserted PII-free in @repo/types).

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  PointsSummaryDto,
  LeaderboardEntryDto,
  UpdateGamificationPrefsDto,
} from "@repo/types";
import { UpdateGamificationPrefsDtoSchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { GamificationService } from "./gamification.service";

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class GamificationController {
  constructor(private readonly service: GamificationService) {}

  /** GET /api/v1/me/gamification — own points, badges, streak, leaderboard prefs. */
  @Get("me/gamification")
  @RequirePermission("gamification.view")
  async getMyGamification(@CurrentUser() user: RequestUser): Promise<PointsSummaryDto> {
    return this.service.getMyGamification(user.tenantId, user.id);
  }

  /** PUT /api/v1/me/gamification/prefs — leaderboard opt-in + alias (own-scope). */
  @Put("me/gamification/prefs")
  @RequirePermission("gamification.view")
  async updatePrefs(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(UpdateGamificationPrefsDtoSchema)) body: UpdateGamificationPrefsDto,
  ): Promise<PointsSummaryDto> {
    return this.service.updatePrefs(user.tenantId, user.id, body);
  }

  /** GET /api/v1/batches/:id/leaderboard — enrollment-scoped, opt-in, PII-minimal. */
  @Get("batches/:id/leaderboard")
  @RequirePermission("gamification.view")
  async getLeaderboard(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) batchId: string,
  ): Promise<LeaderboardEntryDto[]> {
    return this.service.getLeaderboard(user.tenantId, user.id, batchId);
  }
}
