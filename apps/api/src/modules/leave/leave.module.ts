// apps/api/src/modules/leave/leave.module.ts
//
// Staff leave management (docs/specs/leave-management.md, ADR-0065).
//
// Imports:
//   AuthModule          — JwtAuthGuard, PermissionsGuard, ScopeInterceptor. Every route here
//                         is staff-only; there is no public or anonymous surface.
//   NotificationsModule — NotificationsService, for the approver fan-out on a new request and
//                         the decision notice back to the applicant.

import { Module } from "@nestjs/common";

import { OrgModule } from "../org/org.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";

import {
  LeaveApprovalsController,
  LeaveController,
  LeaveSetupController,
} from "./leave.controller";
import { LeaveNotificationService } from "./leave-notification.service";
import { LeaveSetupService } from "./leave-setup.service";
import { LeaveRepository } from "./leave.repository";
import { LeaveService } from "./leave.service";

@Module({
  imports: [AuthModule, NotificationsModule, OrgModule],
  controllers: [LeaveController, LeaveApprovalsController, LeaveSetupController],
  providers: [LeaveService, LeaveSetupService, LeaveNotificationService, LeaveRepository],
})
export class LeaveModule {}
