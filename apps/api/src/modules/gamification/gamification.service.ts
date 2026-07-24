// apps/api/src/modules/gamification/gamification.service.ts
//
// GamificationService — business logic for WS-3 Gamification (docs/plans/phase-6.md task #8).
// (CLAUDE.md §3.3: "service — business logic, transactions, idempotency. No Prisma in
// controllers.")
//
// ─── IDEMPOTENT, EVENT-DRIVEN AWARDS (AC-44..AC-48) ─────────────────────────────
//
// There is NO event bus in this codebase (confirmed: no @nestjs/event-emitter / cqrs).
// Following the established pattern (NotificationsService P4/P5 wiring), the award
// entry-points are PUBLIC methods that the learning modules call after their commit.
// Each award is keyed by a dedupe ref `(user_id, reason, ref)`; the DB partial-unique
// makes a replay a NO-OP (P2002 swallowed). Points are NEVER mutated — reversals would
// be negative-delta rows (AC-48). Badges dedupe via the (user_id, badge_id) unique (AC-46).
//
// TODO (per-service wiring — the learning modules invoke these after their own commit):
//   ProgressService (P3, lesson-completed):
//     await this.gamification.awardForLessonCompleted(userId, tenantId, lessonCompletionId);
//   AssessmentsService (P4, assessment passed):
//     await this.gamification.awardForAssessmentPassed(userId, tenantId, attemptId);
//   ProjectsService (P4, project approved):
//     await this.gamification.awardForProjectApproved(userId, tenantId, submissionId);
//   CertificatesService (P4, certificate issued):
//     await this.gamification.awardForCertificateIssued(userId, tenantId, certificateId);
// These are additive: they do not change the emitters' existing behavior (AC — no regression).
//
// ─── LEADERBOARD (AC-50, AC-51, AC-52) ──────────────────────────────────────────
//
// Enrollment-scoped: a caller not enrolled in the batch → 404 (IDOR-safe, AC-52).
// Opt-in only: only leaderboard_opt_in=true students appear (AC-50).
// PII-minimal: returns LeaderboardEntryDto (rank/displayName/totalPoints/badgeCount) —
//   no email/phone/userId (compile-asserted in @repo/types). displayName = alias or first
//   name only (AC-50).
// Computed LIVE from the ledger so an opt-out is reflected immediately (strictly better
// than a TTL cache). Redis cache-aside (docs/04 §2.7) is an optimization follow-up.

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  PointsSummaryDto,
  LeaderboardEntryDto,
  UpdateGamificationPrefsDto,
  UserBadgeDto,
  StreakDto,
} from "@repo/types";
import { GamificationRepository } from "./gamification.repository";
import type { UserBadgeRow, StreakRow } from "./gamification.repository";

// ─── Points values per award reason (XP) ────────────────────────────────────────
const POINTS = {
  lesson_completed: 10,
  assignment_on_time: 15,
  assessment_passed: 25,
  certificate_issued: 50,
  project_approved: 100,
} as const;

type AwardReason = keyof typeof POINTS;

// Badge keys (seeded in prisma/seed.ts, docs/02 §19).
const BADGE_FIRST_PROJECT = "first_project_approved";
const BADGE_STREAK_7 = "streak_7_days";
const BADGE_STREAK_30 = "streak_30_days";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(private readonly repo: GamificationRepository) {}

  // ─── Own-scope read: GET /me/gamification ─────────────────────────────────

  async getMyGamification(tenantId: string, userId: string): Promise<PointsSummaryDto> {
    const [totalPoints, badgeRows, streak, prefs] = await Promise.all([
      this.repo.sumPoints(tenantId, userId),
      this.repo.listUserBadges(tenantId, userId),
      this.repo.computeStreak(tenantId, userId),
      this.repo.getGamificationPrefs(userId),
    ]);

    return {
      totalPoints,
      badges: badgeRows.map((b) => this.mapUserBadge(b)),
      streak: this.mapStreak(streak),
      leaderboardOptIn: prefs.leaderboardOptIn,
      leaderboardDisplayName: prefs.leaderboardDisplayName,
    };
  }

  // ─── Own-scope write: PUT /me/gamification/prefs ──────────────────────────

  async updatePrefs(
    tenantId: string,
    userId: string,
    dto: UpdateGamificationPrefsDto,
  ): Promise<PointsSummaryDto> {
    await this.repo.upsertGamificationPrefs(tenantId, userId, {
      leaderboardOptIn: dto.leaderboardOptIn,
      leaderboardDisplayName: dto.leaderboardDisplayName,
    });
    // Return the refreshed summary so the client reflects the new opt-in state.
    return this.getMyGamification(tenantId, userId);
  }

  // ─── Enrollment-scoped read: GET /batches/:id/leaderboard ─────────────────

  async getLeaderboard(
    tenantId: string,
    userId: string,
    batchId: string,
  ): Promise<LeaderboardEntryDto[]> {
    // AC-52: IDOR→404 — the caller must be enrolled in the batch to view its leaderboard.
    const enrollment = await this.repo.findEnrollmentForBatch(tenantId, userId, batchId);
    if (!enrollment) {
      throw new NotFoundException({
        code: "gamification.leaderboard_not_found",
        title: "Leaderboard not found",
        detail: "No accessible leaderboard for this batch.",
      });
    }

    const students = await this.repo.findEnrolledStudentsForLeaderboard(tenantId, batchId);
    // AC-50: opt-in only.
    const optedIn = students.filter((s) => s.leaderboardOptIn);
    if (optedIn.length === 0) return [];

    const userIds = optedIn.map((s) => s.userId);
    const [pointsMap, badgeMap] = await Promise.all([
      this.repo.sumPointsForUsers(tenantId, userIds),
      this.repo.countBadgesForUsers(tenantId, userIds),
    ]);

    const ranked = optedIn
      .map((s) => ({
        // PII-minimal: alias if set, else first name only. NEVER full name/email/phone.
        displayName: s.leaderboardDisplayName ?? s.firstName,
        totalPoints: pointsMap.get(s.userId) ?? 0,
        badgeCount: badgeMap.get(s.userId) ?? 0,
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .map((entry, i): LeaderboardEntryDto => ({
        rank: i + 1,
        displayName: entry.displayName,
        totalPoints: entry.totalPoints,
        badgeCount: entry.badgeCount,
      }));

    return ranked;
  }

  // ─── Idempotent award entry-points (called by learning modules) ───────────

  async awardForLessonCompleted(userId: string, tenantId: string, ref: string): Promise<void> {
    await this.award(userId, tenantId, "lesson_completed", ref);
    // Daily activity may extend a streak → check streak-milestone badges.
    await this.checkStreakBadges(userId, tenantId, ref);
  }

  async awardForAssignmentOnTime(userId: string, tenantId: string, ref: string): Promise<void> {
    await this.award(userId, tenantId, "assignment_on_time", ref);
  }

  async awardForAssessmentPassed(userId: string, tenantId: string, ref: string): Promise<void> {
    await this.award(userId, tenantId, "assessment_passed", ref);
    await this.checkStreakBadges(userId, tenantId, ref);
  }

  async awardForProjectApproved(userId: string, tenantId: string, ref: string): Promise<void> {
    await this.award(userId, tenantId, "project_approved", ref);
    // First approved project → the "first_project_approved" badge (once, AC-46).
    await this.awardBadgeByKey(userId, tenantId, BADGE_FIRST_PROJECT, ref);
  }

  async awardForCertificateIssued(userId: string, tenantId: string, ref: string): Promise<void> {
    await this.award(userId, tenantId, "certificate_issued", ref);
  }

  // ─── Private: append-only idempotent points award ─────────────────────────

  /**
   * Append a points row keyed by (user_id, reason, ref). The DB partial-unique
   * makes a replayed event a no-op (AC-44, AC-47). Never mutates existing rows.
   */
  private async award(userId: string, tenantId: string, reason: AwardReason, ref: string): Promise<void> {
    try {
      await this.repo.appendLedgerRow({
        tenantId,
        userId,
        delta: POINTS[reason],
        reason,
        ref,
      });
      this.logger.debug(`[Gamification] awarded ${POINTS[reason]}xp reason=${reason} user=${userId} ref=${ref}`);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Replay — already awarded. Idempotent no-op (AC-44).
        this.logger.debug(`[Gamification] duplicate award ignored reason=${reason} user=${userId} ref=${ref}`);
        return;
      }
      throw err;
    }
  }

  /**
   * Award a badge by its catalog key, idempotently (one award per user+badge, AC-46).
   */
  private async awardBadgeByKey(
    userId: string,
    tenantId: string,
    key: string,
    ref: string,
  ): Promise<void> {
    const badge = await this.repo.findBadgeByKey(tenantId, key);
    if (!badge) {
      this.logger.warn(`[Gamification] badge key not found in catalog: ${key} (tenant=${tenantId})`);
      return;
    }
    try {
      await this.repo.awardBadge({ tenantId, userId, badgeId: badge.id, ref, awardedAt: new Date() });
      this.logger.log(`[Gamification] badge awarded key=${key} user=${userId}`);
    } catch (err) {
      if (isUniqueViolation(err)) return; // already has it — no-op (AC-46)
      throw err;
    }
  }

  /**
   * Check and award streak-milestone badges based on the user's current streak.
   * Idempotent: the badge unique makes re-award a no-op.
   */
  private async checkStreakBadges(userId: string, tenantId: string, ref: string): Promise<void> {
    const streak = await this.repo.computeStreak(tenantId, userId);
    if (streak.currentDays >= 30) {
      await this.awardBadgeByKey(userId, tenantId, BADGE_STREAK_30, `${ref}:streak30`);
    }
    if (streak.currentDays >= 7) {
      await this.awardBadgeByKey(userId, tenantId, BADGE_STREAK_7, `${ref}:streak7`);
    }
  }

  // ─── DTO mapping ──────────────────────────────────────────────────────────

  private mapUserBadge(row: UserBadgeRow): UserBadgeDto {
    return {
      id: row.id,
      badge: {
        id: row.badge.id,
        key: row.badge.key,
        name: row.badge.name,
        description: row.badge.description ?? "",
        icon: row.badge.icon ?? "trophy",
      },
      awardedAt: row.awardedAt.toISOString(),
      ref: row.ref,
    };
  }

  private mapStreak(row: StreakRow): StreakDto {
    return {
      currentDays: row.currentDays,
      longestDays: row.longestDays,
      lastActivityAt: row.lastActivityAt ? row.lastActivityAt.toISOString() : null,
      isActive: row.isActive,
    };
  }
}
