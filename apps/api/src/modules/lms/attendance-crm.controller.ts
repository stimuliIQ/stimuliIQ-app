// apps/api/src/modules/lms/attendance-crm.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Closes Phase-9-completion gap #6: the CRM
// attendance roster (apps/crm/src/components/attendance/batch-attendance-roster.tsx)
// was read-only. Mounted at /api/v1/crm/attendance.
//
// Permission: attendance.edit (scope: assigned|all) — faculty may only correct
// attendance for enrollments in batches they teach; admin/super_admin may correct any.

import { Body, Controller, HttpCode, HttpStatus, Patch, UseGuards, UseInterceptors } from "@nestjs/common";
import type { AttendanceRecord, SetAttendanceRequest } from "@repo/types";
import { SetAttendanceRequestSchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { requireScopeContext } from "../auth/lib/scope-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { LmsProgressService } from "./lms-progress.service";

@Controller("crm/attendance")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class AttendanceCrmController {
  constructor(private readonly progressService: LmsProgressService) {}

  /**
   * PATCH /api/v1/crm/attendance
   * Set/correct a student's attendance for a (enrollment, lesson) pair.
   * AUDITED. Permission: attendance.edit (scope: assigned|all).
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  @RequirePermission("attendance.edit")
  async setAttendance(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(SetAttendanceRequestSchema)) body: SetAttendanceRequest,
  ): Promise<AttendanceRecord> {
    // SECURITY (M1): fail CLOSED. Previously `getScopeContext()?.scope ?? "all"` widened
    // an unresolved scope to "all" — a faculty grant that failed to resolve would have
    // been able to correct ANY student's attendance tenant-wide. requireScopeContext()
    // throws if the interceptor didn't set a scope, so we never silently escalate.
    const scope = requireScopeContext().scope as "all" | "assigned" | "branch";
    return this.progressService.setAttendance(user.tenantId, user.id, scope, body);
  }
}
