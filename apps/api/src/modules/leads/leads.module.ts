// apps/api/src/modules/leads/leads.module.ts
//
// Wires the leads/activities/bookings feature module (docs/04-trd-architecture.md §2.2
// template). Imports CommerceModule to REUSE CommerceService for conversion-with-order
// (the orchestrator's explicit instruction: "Commerce was built in Wave 4a — REUSE its
// CommerceService for conversion-with-order; do NOT rebuild commerce") and imports
// StudentsModule to reuse StudentsRepository.createStudentWithUser for the lead->student
// conversion's user+profile creation step (mirrors the P1 students-create transaction
// rather than duplicating it).
//
// PublicBookingsController has NO guards applied (see bookings.controller.ts file
// header) — it is registered in this module's `controllers` array like any other
// controller; the absence of `@UseGuards` on the class itself is what makes it
// unauthenticated. It is excluded from CsrfMiddleware in app.module.ts.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommerceModule } from "../commerce/commerce.module";
import { StudentsModule } from "../students/students.module";
import { CaptchaProviderModule } from "../captcha/providers/captcha/captcha-provider.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { LeadsRepository } from "./leads.repository";
import { ActivitiesController } from "./activities.controller";
import { ActivitiesService } from "./activities.service";
import { ActivitiesRepository } from "./activities.repository";
import { BookingsController, PublicBookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";
import { BookingsRepository } from "./bookings.repository";
import { PublicBookingRateLimiter } from "./lib/public-booking-rate-limiter";

@Module({
  // NotificationsModule: LeadsService rings the new owner's bell on assignment
  // (NotificationsService.notifyLeadAssigned). Notifications has no dependency back on
  // leads, so this stays a one-way edge — no circular-module forwardRef needed.
  imports: [AuthModule, CommerceModule, StudentsModule, CaptchaProviderModule, NotificationsModule],
  controllers: [LeadsController, ActivitiesController, BookingsController, PublicBookingsController],
  providers: [
    LeadsService,
    LeadsRepository,
    ActivitiesService,
    ActivitiesRepository,
    BookingsService,
    BookingsRepository,
    PublicBookingRateLimiter,
  ],
  // LeadsService exported (in addition to the repositories) so the Phase-7 exports
  // module (docs/plans/phase-7.md task #8) can reuse the EXACT SAME scoped `.list()`
  // method the on-screen lead pipeline calls (Rule H-2, AC-30/31/32).
  exports: [LeadsRepository, ActivitiesRepository, BookingsRepository, LeadsService],
})
export class LeadsModule {}
