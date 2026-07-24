// apps/api/src/modules/gamification/gamification.module.ts
//
// GamificationModule — WS-3 Gamification (docs/plans/phase-6.md task #8).
//
// Layering (CLAUDE.md §3.3):
//   GamificationController — GET/PUT /me/gamification* + GET /batches/:id/leaderboard
//   GamificationService    — idempotent event-driven awards (points/badges/streaks) +
//                            enrollment-scoped, PII-minimal leaderboard
//   GamificationRepository — Prisma data access (points_ledger, user_badges, badges,
//                            enrollment scope, leaderboard aggregate)
//
// Imports:
//   AuthModule — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//
// Exports:
//   GamificationService — exported so the learning modules (Progress/Assessments/
//   Projects/Certificates) can inject it to award points after their own commits
//   (the additive, no-regression wiring described in the service header).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GamificationController } from "./gamification.controller";
import { GamificationService } from "./gamification.service";
import { GamificationRepository } from "./gamification.repository";

@Module({
  imports: [AuthModule],
  controllers: [GamificationController],
  providers: [GamificationService, GamificationRepository],
  exports: [GamificationService],
})
export class GamificationModule {}
