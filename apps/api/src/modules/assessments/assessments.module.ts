// apps/api/src/modules/assessments/assessments.module.ts
//
// P4 Wave 4 task #7 — Assessments + Attempts.
// Pre-registered in AppModule — DO NOT edit app.module.ts.
//
// Layering (CLAUDE.md §3.3):
//   controller → service → repository.
//
// Security invariants enforced:
//   - Answer key NEVER serialized to student-facing response (AC-J9, AC-D2).
//   - Time-box enforced server-side (AC-D4, plan §6 Risk #6).
//   - attempts_allowed enforced server-side (AC-D5).
//   - Idempotent attempt submit (AC-D7).
//   - IDOR → 404 for cross-student/cross-tenant access (ADR-0022).
//   - Faculty assigned-scope via attempt → enrollment → batch → faculty_id (plan §6 Risk #1).
//   - RBAC via @RequirePermission + PermissionsGuard + ScopeInterceptor.
//
// Controllers:
//   AssessmentsCrmController — CRM routes at /crm/assessments, /crm/attempts
//   AssessmentsLmsController — LMS routes at /me/assessments, /me/attempts

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GamificationModule } from "../gamification/gamification.module";
import { AssessmentsRepository } from "./assessments.repository";
import { AssessmentsService } from "./assessments.service";
import { AssessmentsCrmController } from "./assessments-crm.controller";
import { AssessmentsLmsController } from "./assessments-lms.controller";

@Module({
  // GamificationModule: XP for a passed attempt (AssessmentsService.submitAttempt and
  // the descriptive-grading path). It imports only AuthModule, so there is no cycle.
  imports: [AuthModule, GamificationModule],
  controllers: [AssessmentsCrmController, AssessmentsLmsController],
  providers: [AssessmentsService, AssessmentsRepository],
  exports: [AssessmentsService, AssessmentsRepository],
})
export class AssessmentsModule {}
