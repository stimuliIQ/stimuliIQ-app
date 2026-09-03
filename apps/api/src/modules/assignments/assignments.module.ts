// apps/api/src/modules/assignments/assignments.module.ts
//
// P4 Wave 4 task #6 — Assignments + Submissions + Projects.
//
// Layering (CLAUDE.md §3.3):
//   controller → service → repository.
//   RBAC via @RequirePermission + PermissionsGuard + ScopeInterceptor.
//   Student own-scope: IDOR → 404 via enrollment gate in service.
//   Faculty assigned-scope: submission → enrollment → batch → faculty_id (plan §6 Risk #1).
//   Grade changes audited with before/after (AC-B1, AC-B3).
//   Files stored as storage keys; signed download URLs minted on demand.
//
// Controllers:
//   AssignmentsCrmController — CRM routes at /crm/assignments, /crm/submissions
//   AssignmentsLmsController — LMS routes at /me/assignments
//   StorageController        — Storage upload-URL at /storage/upload-url
//
// Imports:
//   AuthModule              — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   StorageProviderModule   — STORAGE_PROVIDER token (Noop/S3/R2)
//
// DO NOT edit app.module.ts — this module is already registered there.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { StudentsModule } from "../students/students.module";
import { GamificationModule } from "../gamification/gamification.module";
import { AssignmentsRepository } from "./assignments.repository";
import { AssignmentsService } from "./assignments.service";
import { AssignmentsCrmController } from "./assignments-crm.controller";
import { AssignmentsLmsController } from "./assignments-lms.controller";
import { StorageController } from "./storage.controller";
import { DeadlineRemindersScheduler } from "./deadline-reminders.scheduler";

@Module({
  imports: [
    AuthModule,
    StorageProviderModule,
    // Phase-9 Completion T31 / R3: notifyGradeReady (post-grading) + notifyDeadline
    // (DeadlineRemindersScheduler) both need NotificationsService.
    NotificationsModule,
    // Resolves a submission's/enrollment's student_profiles.id -> {userId, email,
    // phone, name} for both notifyGradeReady and DeadlineRemindersScheduler.
    StudentsModule,
    // XP for an on-time submission and for an approved project (AssignmentsService).
    // GamificationModule imports only AuthModule, so there is no cycle.
    GamificationModule,
  ],
  controllers: [
    AssignmentsCrmController,
    AssignmentsLmsController,
    StorageController,
  ],
  providers: [
    AssignmentsService,
    AssignmentsRepository,
    // Phase-9 Completion T31 / R3: scans assignments.due_at ~24h out and fires
    // notifyDeadline for enrolled-not-yet-submitted students (see that file's header
    // for the dedup-by-time-bucket design and isSchedulerEnabled() test-safety gate).
    DeadlineRemindersScheduler,
  ],
  exports: [
    AssignmentsService,
    AssignmentsRepository,
  ],
})
export class AssignmentsModule {}
