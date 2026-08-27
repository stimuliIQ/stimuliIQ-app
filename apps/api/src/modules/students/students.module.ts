// apps/api/src/modules/students/students.module.ts
//
// Wires the students feature module (docs/04-trd-architecture.md §2.2 template). Imports
// AuthModule for the guards/interceptor it reuses (JwtAuthGuard, PermissionsGuard,
// ScopeInterceptor) rather than redeclaring providers — single DI source per CLAUDE.md §3.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommonScopeModule } from "../common-scope/common-scope.module";
import { FacultyModule } from "../faculty/faculty.module";
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { CourseTypesModule } from "../course-types/course-types.module";
import { StudentsController } from "./students.controller";
import { StudentsService } from "./students.service";
import { StudentsRepository } from "./students.repository";
import { LmsAccountProvisioningService } from "./lms-account-provisioning.service";

@Module({
  // MailProviderModule: for the LMS welcome email sent when an account is auto-provisioned
  // on enrollment (lifecycle-redesign P3).
  // CourseTypesModule: course types are CRM-managed rows now, so this module validates the
  // submitted key against the tenant's active options and resolves labels for reads.
  imports: [AuthModule, CommonScopeModule, FacultyModule, MailProviderModule, CourseTypesModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentsRepository, LmsAccountProvisioningService],
  // StudentsService exported (in addition to StudentsRepository) so the Phase-7
  // exports module (docs/plans/phase-7.md task #8) can reuse the EXACT SAME scoped
  // `.list()` method the on-screen student directory calls — Rule H-2 (AC-30/31/32:
  // "export never leaks data outside the requester's scope" — enforced by literally
  // being the same code path, not a parallel re-implementation).
  // LmsAccountProvisioningService exported so the enrollment paths (manual enroll +
  // payment-captured webhook) can provision the LMS login on successful enrollment.
  exports: [StudentsRepository, StudentsService, LmsAccountProvisioningService],
})
export class StudentsModule {}
