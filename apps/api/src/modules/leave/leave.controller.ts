// apps/api/src/modules/leave/leave.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3) — validate, delegate, return a DTO.
//
// Three controllers in one file, split by AUDIENCE rather than by resource:
//
//   LeaveController        — what any member of staff does: apply, withdraw, see their own
//                            requests and balances. Gated on `leave.view` / `leave.request`,
//                            which every staff role holds at scope=own.
//   LeaveApprovalsController — the decisions. Gated on `leave.approve`, which is seeded to
//                            super_admin ALONE (prisma/seed.ts, the dedicated block outside
//                            the admin catch-all). Admin does not hold it.
//   LeaveSetupController   — leave types, allowances, holidays, the working week. WRITES are
//                            gated on `leave.manage`, also super_admin alone; the READS are
//                            open to `leave.view` because the apply form needs the types and
//                            the calendar needs the holidays.
//
// The calendar sits on its own key, `leave.calendar.view`, held at scope=all by every staff
// role — see the schema file and prisma/seed.ts for why it is not folded into `leave.view`.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  ApproveLeaveRequestRequest,
  CreateHolidayRequest,
  CreateLeaveRequestRequest,
  CreateLeaveTypeRequest,
  GetLeaveApplyContextQuery,
  GetLeaveBalancesQuery,
  GetLeaveCalendarQuery,
  Holiday,
  LeaveApplyContext,
  LeaveBalancesResponse,
  LeaveCalendarResponse,
  LeaveQuota,
  LeaveRequestDetail,
  LeaveRequestSummary,
  LeaveSetting,
  LeaveType,
  ListHolidaysQuery,
  ListLeaveQuotasQuery,
  ListLeaveRequestsQuery,
  ListLeaveTypesQuery,
  RejectLeaveRequestRequest,
  SaveLeaveQuotasRequest,
  UpdateHolidayRequest,
  UpdateLeaveSettingRequest,
  UpdateLeaveTypeRequest,
} from "@repo/types";
import {
  ApproveLeaveRequestRequestSchema,
  CreateHolidayRequestSchema,
  CreateLeaveRequestRequestSchema,
  CreateLeaveTypeRequestSchema,
  GetLeaveApplyContextQuerySchema,
  GetLeaveBalancesQuerySchema,
  GetLeaveCalendarQuerySchema,
  ListHolidaysQuerySchema,
  ListLeaveQuotasQuerySchema,
  ListLeaveRequestsQuerySchema,
  ListLeaveTypesQuerySchema,
  RejectLeaveRequestRequestSchema,
  SaveLeaveQuotasRequestSchema,
  UpdateHolidayRequestSchema,
  UpdateLeaveSettingRequestSchema,
  UpdateLeaveTypeRequestSchema,
} from "@repo/types";

import { PaginatedResult } from "../../common/dto/paginated-result";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import type { RequestUser } from "../auth/lib/request-user";
import { LeaveSetupService } from "./leave-setup.service";
import { LeaveService } from "./leave.service";

// ─────────────────────────────────────────────────────────────────────────────
// Any member of staff: apply, withdraw, look at your own leave
// ─────────────────────────────────────────────────────────────────────────────

@Controller("crm/leave")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  /**
   * Everything the apply form needs in one call — working week, holidays, types and the
   * applicant's balances — so the browser's live day count can never be computed against a
   * stale holiday list.
   */
  @Get("apply-context")
  @RequirePermission("leave.request")
  async applyContext(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(GetLeaveApplyContextQuerySchema)) query: GetLeaveApplyContextQuery,
  ): Promise<LeaveApplyContext> {
    return this.service.getApplyContext(user.tenantId, user.id, query);
  }

  @Get("balances")
  @RequirePermission("leave.view")
  async balances(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(GetLeaveBalancesQuerySchema)) query: GetLeaveBalancesQuery,
  ): Promise<LeaveBalancesResponse> {
    return this.service.getBalances(user.tenantId, user.id, query);
  }

  /**
   * Who is out, when. Its own permission and a projection that never fetches the reason —
   * team visibility without turning everybody's reason for being off into company reading.
   */
  @Get("calendar")
  @RequirePermission("leave.calendar.view")
  async calendar(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(GetLeaveCalendarQuerySchema)) query: GetLeaveCalendarQuery,
  ): Promise<LeaveCalendarResponse> {
    return this.service.getCalendar(user.tenantId, user.id, query);
  }

  @Get("requests")
  @RequirePermission("leave.view")
  async listRequests(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListLeaveRequestsQuerySchema)) query: ListLeaveRequestsQuery,
  ): Promise<PaginatedResult<LeaveRequestSummary>> {
    return this.service.listRequests(user.tenantId, query);
  }

  @Get("requests/:id")
  @RequirePermission("leave.view")
  async getRequest(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<LeaveRequestDetail> {
    return this.service.getRequest(user.tenantId, id);
  }

  /** The applicant is always the session user — this body carries no user id by design. */
  @Post("requests")
  @RequirePermission("leave.request")
  async createRequest(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateLeaveRequestRequestSchema)) body: CreateLeaveRequestRequest,
  ): Promise<LeaveRequestDetail> {
    return this.service.createRequest(user.tenantId, user.id, body);
  }

  @Post("requests/:id/cancel")
  @RequirePermission("leave.request")
  @HttpCode(HttpStatus.OK)
  async cancelRequest(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<LeaveRequestDetail> {
    return this.service.cancelRequest(user.tenantId, user.id, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The decisions — super_admin only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Separate from the ordinary-staff routes because approving is a different power, not a
 * different resource. `leave.approve` is upserted outside the seed's permission catalog so
 * that `admin` does not inherit it from the catch-all — see prisma/seed.ts.
 */
@Controller("crm/leave/approvals")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LeaveApprovalsController {
  constructor(private readonly service: LeaveService) {}

  @Post(":id/approve")
  @RequirePermission("leave.approve")
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ApproveLeaveRequestRequestSchema)) body: ApproveLeaveRequestRequest,
  ): Promise<LeaveRequestDetail> {
    return this.service.approveRequest(user.tenantId, user.id, id, body);
  }

  /** The reason is mandatory (schema-enforced) and is emailed to the applicant verbatim. */
  @Post(":id/reject")
  @RequirePermission("leave.approve")
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RejectLeaveRequestRequestSchema)) body: RejectLeaveRequestRequest,
  ): Promise<LeaveRequestDetail> {
    return this.service.rejectRequest(user.tenantId, user.id, id, body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — reads open to staff, writes super_admin only
// ─────────────────────────────────────────────────────────────────────────────

@Controller("crm/leave/setup")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LeaveSetupController {
  constructor(private readonly setup: LeaveSetupService) {}

  // Types — read by the apply form, written by the super admin.

  @Get("types")
  @RequirePermission("leave.view")
  async listTypes(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListLeaveTypesQuerySchema)) query: ListLeaveTypesQuery,
  ): Promise<LeaveType[]> {
    return this.setup.listTypes(user.tenantId, query.activeOnly);
  }

  @Post("types")
  @RequirePermission("leave.manage")
  async createType(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateLeaveTypeRequestSchema)) body: CreateLeaveTypeRequest,
  ): Promise<LeaveType> {
    return this.setup.createType(user.tenantId, body);
  }

  @Patch("types/:id")
  @RequirePermission("leave.manage")
  async updateType(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateLeaveTypeRequestSchema)) body: UpdateLeaveTypeRequest,
  ): Promise<LeaveType> {
    return this.setup.updateType(user.tenantId, id, body);
  }

  @Delete("types/:id")
  @RequirePermission("leave.manage")
  async deleteType(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ deleted: true }> {
    await this.setup.deleteType(user.tenantId, id);
    return { deleted: true };
  }

  // Allowances — the whole year saved as one grid.

  @Get("quotas")
  @RequirePermission("leave.view")
  async listQuotas(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListLeaveQuotasQuerySchema)) query: ListLeaveQuotasQuery,
  ): Promise<LeaveQuota[]> {
    return this.setup.listQuotas(user.tenantId, query.year);
  }

  @Put("quotas")
  @RequirePermission("leave.manage")
  async saveQuotas(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(SaveLeaveQuotasRequestSchema)) body: SaveLeaveQuotasRequest,
  ): Promise<LeaveQuota[]> {
    return this.setup.saveQuotas(user.tenantId, body);
  }

  // Holidays — read by the calendar and the duration calculation, written by the super admin.

  @Get("holidays")
  @RequirePermission("leave.view")
  async listHolidays(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListHolidaysQuerySchema)) query: ListHolidaysQuery,
  ): Promise<Holiday[]> {
    return this.setup.listHolidays(user.tenantId, query.year);
  }

  @Post("holidays")
  @RequirePermission("leave.manage")
  async createHoliday(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateHolidayRequestSchema)) body: CreateHolidayRequest,
  ): Promise<Holiday> {
    return this.setup.createHoliday(user.tenantId, body);
  }

  @Patch("holidays/:id")
  @RequirePermission("leave.manage")
  async updateHoliday(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateHolidayRequestSchema)) body: UpdateHolidayRequest,
  ): Promise<Holiday> {
    return this.setup.updateHoliday(user.tenantId, id, body);
  }

  @Delete("holidays/:id")
  @RequirePermission("leave.manage")
  async deleteHoliday(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ deleted: true }> {
    await this.setup.deleteHoliday(user.tenantId, id);
    return { deleted: true };
  }

  // The working week.

  @Get("settings")
  @RequirePermission("leave.view")
  async getSetting(@CurrentUser() user: RequestUser): Promise<LeaveSetting> {
    return this.setup.getSetting(user.tenantId);
  }

  @Patch("settings")
  @RequirePermission("leave.manage")
  async updateSetting(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(UpdateLeaveSettingRequestSchema)) body: UpdateLeaveSettingRequest,
  ): Promise<LeaveSetting> {
    return this.setup.updateSetting(user.tenantId, body);
  }
}
