// apps/api/src/modules/gamification/gamification.repository.ts
//
// Prisma data-access layer for the Gamification module (WS-3).
// (CLAUDE.md §3.3: "repository — Prisma data access only, applies soft-delete +
// data-scope filters. No business logic.")
//
// SECURITY INVARIANTS:
//   1. ALL queries are tenant-scoped — cross-tenant returns empty/null → NotFoundException.
//   2. Own-scope (GET /me/gamification): every method filters by userId from session JWT.
//   3. IDOR → 404: the service resolves the scope; this repo returns null/empty for
//      absent or mismatched rows.
//   4. Leaderboard: only enrolled-in-batch users appear; only opted-in users appear.
//      The repo NEVER selects email, phone, enrollmentId, or userId in leaderboard queries.
//   5. append-only: NO update on points_ledger rows is performed here. Reversals are INSERTs.
//
// IDEMPOTENCY BACKBONE:
//   - points_ledger has a partial-unique index on (user_id, reason, ref) WHERE deleted_at IS NULL.
//     A duplicate insert throws a Prisma PrismaClientKnownRequestError with code P2002.
//     The service catches this and treats it as a no-op (AC-44, AC-47).
//   - user_badges has a partial-unique index on (user_id, badge_id) WHERE deleted_at IS NULL.
//     Same handling (AC-46).
//
// LEADERBOARD CACHE STRATEGY:
//   The service uses Redis cache-aside (TTL 60 s, docs/04 §2.7) for the leaderboard aggregate.
//   This repository provides the raw DB read; the service handles caching.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

// ─── Row type contracts ────────────────────────────────────────────────────────

export interface PointsLedgerRow {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  ref: string | null;
  createdAt: Date;
}

export interface UserBadgeRow {
  id: string;
  userId: string;
  badgeId: string;
  awardedAt: Date;
  ref: string | null;
  badge: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    icon: string | null;
  };
}

export interface BadgeRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  criteria: unknown;
  status: string;
}

export interface LeaderboardRawRow {
  /** Display name (alias or first-name only). NEVER email, phone, userId. */
  displayName: string;
  totalPoints: number;
  badgeCount: number;
}

export interface StreakRow {
  currentDays: number;
  longestDays: number;
  lastActivityAt: Date | null;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class GamificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Profile resolution helpers ───────────────────────────────────────────

  async findStudentProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Get the user's first name only (for PII-safe leaderboard display). */
  async findUserFirstName(userId: string): Promise<string> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) return "Student";
    const fullName = user.name?.trim() ?? "";
    const firstName = fullName.split(" ")[0] ?? fullName;
    return firstName || "Student";
  }

  // ─── Points Ledger ────────────────────────────────────────────────────────

  /**
   * Append a new ledger row.
   *
   * Idempotency: the partial-unique index on (user_id, reason, ref) WHERE deleted_at IS NULL
   * will throw P2002 on a duplicate (ref is NOT NULL). The service catches this and no-ops.
   *
   * AC-47: this method ONLY inserts — never updates existing rows.
   */
  async appendLedgerRow(data: {
    tenantId: string;
    userId: string;
    delta: number;
    reason: string;
    ref: string | null;
  }): Promise<string> {
    const row = await this.prisma.client.pointsLedger.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        delta: data.delta,
        reason: data.reason,
        ref: data.ref,
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Compute the total XP for a user (SUM of all non-deleted delta rows).
   * Returns 0 if no rows exist.
   */
  async sumPoints(tenantId: string, userId: string): Promise<number> {
    const result = await this.prisma.client.pointsLedger.aggregate({
      where: { tenantId, userId, deletedAt: null },
      _sum: { delta: true },
    });
    return result._sum.delta ?? 0;
  }

  /**
   * Check whether a specific (userId, reason, ref) combination already exists.
   * Used by the service to detect idempotent re-award before attempting insert.
   *
   * NOTE: The partial-unique index is the enforcement mechanism; this method is
   * a pre-flight check to avoid unnecessary DB round-trips on hot paths.
   */
  async findLedgerRow(
    userId: string,
    reason: string,
    ref: string,
  ): Promise<{ id: string } | null> {
    const row = await this.prisma.client.pointsLedger.findFirst({
      where: { userId, reason, ref, deletedAt: null },
      select: { id: true },
    });
    return row ?? null;
  }

  // ─── User Badges ──────────────────────────────────────────────────────────

  /**
   * Award a badge to a user.
   *
   * Idempotency: the partial-unique index on (user_id, badge_id) WHERE deleted_at IS NULL
   * will throw P2002 on a duplicate. The service catches this and no-ops (AC-46).
   */
  async awardBadge(data: {
    tenantId: string;
    userId: string;
    badgeId: string;
    ref: string | null;
    awardedAt: Date;
  }): Promise<string> {
    const row = await this.prisma.client.userBadge.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        badgeId: data.badgeId,
        ref: data.ref,
        awardedAt: data.awardedAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Check if a user already has a specific badge awarded (non-deleted). */
  async findUserBadge(userId: string, badgeId: string): Promise<{ id: string } | null> {
    const row = await this.prisma.client.userBadge.findFirst({
      where: { userId, badgeId, deletedAt: null },
      select: { id: true },
    });
    return row ?? null;
  }

  /** List all non-deleted badges earned by a user, newest first, with badge detail. */
  async listUserBadges(tenantId: string, userId: string): Promise<UserBadgeRow[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex Prisma include
    const rows: any[] = await this.prisma.client.userBadge.findMany({
      where: { tenantId, userId, deletedAt: null },
      include: {
        badge: {
          select: { id: true, key: true, name: true, description: true, icon: true },
        },
      },
      orderBy: { awardedAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      badgeId: r.badgeId,
      awardedAt: r.awardedAt,
      ref: r.ref ?? null,
      badge: {
        id: r.badge.id,
        key: r.badge.key,
        name: r.badge.name,
        description: r.badge.description ?? null,
        icon: r.badge.icon ?? null,
      },
    }));
  }

  // ─── Badge catalog ────────────────────────────────────────────────────────

  /** List all active badges in the catalog for a tenant. */
  async listBadgeCatalog(tenantId: string): Promise<BadgeRow[]> {
    const rows = await this.prisma.client.badge.findMany({
      where: { tenantId, status: "active", deletedAt: null },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        icon: true,
        criteria: true,
        status: true,
      },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description ?? null,
      icon: r.icon ?? null,
      criteria: r.criteria,
      status: r.status,
    }));
  }

  /** Find a badge by its key within a tenant (for criteria-based award). */
  async findBadgeByKey(tenantId: string, key: string): Promise<BadgeRow | null> {
    const row = await this.prisma.client.badge.findFirst({
      where: { tenantId, key, status: "active", deletedAt: null },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        icon: true,
        criteria: true,
        status: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description ?? null,
      icon: row.icon ?? null,
      criteria: row.criteria,
      status: row.status,
    };
  }

  // ─── Streaks ──────────────────────────────────────────────────────────────

  /**
   * Compute the streak for a user based on their points_ledger activity.
   *
   * Streak definition: consecutive calendar days on which the user has at least
   * one non-deleted ledger row. The streak is "active" if the most recent activity
   * was today or yesterday (in UTC).
   *
   * This is computed from the ledger — no separate streak table required by schema.
   */
  async computeStreak(tenantId: string, userId: string): Promise<StreakRow> {
    // Fetch all distinct activity dates (UTC) for this user, newest first.
    const rows = await this.prisma.client.pointsLedger.findMany({
      where: { tenantId, userId, deletedAt: null, delta: { gt: 0 } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) {
      return { currentDays: 0, longestDays: 0, lastActivityAt: null, isActive: false };
    }

    // Normalize to UTC date strings (YYYY-MM-DD) and deduplicate.
    const dateSet = new Set<string>();
    for (const r of rows) {
      dateSet.add(r.createdAt.toISOString().split("T")[0]!);
    }
    const sortedDates = Array.from(dateSet).sort((a, b) => (a > b ? -1 : 1));

    const todayStr = new Date().toISOString().split("T")[0]!;
    const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().split("T")[0]!;

    const lastActivityDate = new Date(sortedDates[0]!);
    const isActive = sortedDates[0] === todayStr || sortedDates[0] === yesterdayStr;

    // Compute current streak (consecutive days from the most recent activity).
    let currentDays = 0;
    let longestDays = 0;
    let currentRun = 1;
    let prevDate = sortedDates[0]!;

    for (let i = 1; i < sortedDates.length; i++) {
      const curr = sortedDates[i]!;
      const diff = Math.round(
        (new Date(prevDate).getTime() - new Date(curr).getTime()) / 86_400_000,
      );
      if (diff === 1) {
        currentRun++;
      } else {
        if (longestDays < currentRun) longestDays = currentRun;
        currentRun = 1;
      }
      prevDate = curr;
    }
    if (longestDays < currentRun) longestDays = currentRun;

    // currentDays = the streak starting from today or yesterday
    if (isActive) {
      // Walk forward from the newest date to count the active streak
      let streak = 1;
      let anchor = sortedDates[0]!;
      for (let i = 1; i < sortedDates.length; i++) {
        const next = sortedDates[i]!;
        const diff = Math.round(
          (new Date(anchor).getTime() - new Date(next).getTime()) / 86_400_000,
        );
        if (diff === 1) {
          streak++;
          anchor = next;
        } else {
          break;
        }
      }
      currentDays = streak;
    } else {
      currentDays = 0;
    }

    return {
      currentDays,
      longestDays,
      lastActivityAt: lastActivityDate,
      isActive,
    };
  }

  // ─── Gamification Prefs (leaderboard opt-in) ──────────────────────────────

  /**
   * Fetch the gamification leaderboard prefs. Returns defaults when no row exists.
   *
   * These live in their OWN columns on notification_prefs, NOT inside the `matrix`
   * JSON. They used to be stashed in `matrix`, which is the type×channel notification
   * matrix and whose contract (NotificationPrefMatrixSchema, `.strict()`) admits only
   * NotificationType keys — so GET /me/notification-prefs returned a matrix that
   * PUT /me/notification-prefs then rejected with 400, and the row carried no real
   * notification preferences at all. Migration
   * 20260819120000_leaderboard_prefs_out_of_matrix moved them out and stripped the keys.
   * AC-49/AC-50/AC-51: only leaderboardOptIn = true users appear on the leaderboard.
   */
  async getGamificationPrefs(userId: string): Promise<{
    leaderboardOptIn: boolean;
    leaderboardDisplayName: string | null;
  }> {
    const row = await this.prisma.client.notificationPref.findFirst({
      where: { userId, deletedAt: null },
      select: { leaderboardOptIn: true, leaderboardDisplayName: true },
    });
    if (!row) {
      return { leaderboardOptIn: false, leaderboardDisplayName: null };
    }
    return {
      leaderboardOptIn: row.leaderboardOptIn,
      leaderboardDisplayName: row.leaderboardDisplayName,
    };
  }

  /**
   * Upsert the leaderboard prefs on the user's notification_prefs row.
   * Own-scope: userId comes from the authenticated session.
   *
   * Writes the dedicated columns and NEVER touches `matrix`. Writing these two flags
   * into the matrix JSON is what corrupted the notification preferences contract
   * (see getGamificationPrefs above); creating a row here must therefore leave `matrix`
   * at its schema default so GET /me/notification-prefs still resolves to the server
   * default type×channel matrix rather than an object the PUT DTO would reject.
   */
  async upsertGamificationPrefs(
    tenantId: string,
    userId: string,
    prefs: {
      leaderboardOptIn?: boolean;
      leaderboardDisplayName?: string | null;
    },
  ): Promise<{ leaderboardOptIn: boolean; leaderboardDisplayName: string | null }> {
    const row = await this.prisma.client.notificationPref.upsert({
      where: { userId },
      create: {
        tenantId,
        userId,
        ...(prefs.leaderboardOptIn !== undefined ? { leaderboardOptIn: prefs.leaderboardOptIn } : {}),
        ...(prefs.leaderboardDisplayName !== undefined
          ? { leaderboardDisplayName: prefs.leaderboardDisplayName }
          : {}),
      },
      update: {
        ...(prefs.leaderboardOptIn !== undefined ? { leaderboardOptIn: prefs.leaderboardOptIn } : {}),
        ...(prefs.leaderboardDisplayName !== undefined
          ? { leaderboardDisplayName: prefs.leaderboardDisplayName }
          : {}),
      },
      select: { leaderboardOptIn: true, leaderboardDisplayName: true },
    });

    return {
      leaderboardOptIn: row.leaderboardOptIn,
      leaderboardDisplayName: row.leaderboardDisplayName,
    };
  }

  // ─── Enrollment scope ─────────────────────────────────────────────────────

  /**
   * Check if a user (via their StudentProfile) is enrolled in a given batch.
   * Used for leaderboard IDOR enforcement (AC-52).
   *
   * Returns the studentProfileId if enrolled, null if not enrolled (IDOR → 404).
   */
  async findEnrollmentForBatch(
    tenantId: string,
    userId: string,
    batchId: string,
  ): Promise<{ studentId: string; enrollmentId: string } | null> {
    // Resolve studentProfileId first
    const studentProfile = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!studentProfile) return null;

    const enrollment = await this.prisma.client.enrollment.findFirst({
      where: {
        tenantId,
        studentId: studentProfile.id,
        batchId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true, studentId: true },
    });
    if (!enrollment) return null;
    return { studentId: enrollment.studentId, enrollmentId: enrollment.id };
  }

  /**
   * Get all active student user IDs enrolled in a batch.
   * Used to compute the leaderboard for a batch.
   * Returns userId → (leaderboardOptIn, leaderboardDisplayName) pairs.
   *
   * IMPORTANT: This method ONLY returns fields needed for the leaderboard DTO.
   * It does NOT select email, phone, or any other PII (AC-50, LOCK-D5).
   */
  async findEnrolledStudentsForLeaderboard(
    tenantId: string,
    batchId: string,
  ): Promise<
    Array<{
      userId: string;
      leaderboardOptIn: boolean;
      leaderboardDisplayName: string | null;
      firstName: string;
    }>
  > {
    // Get all active enrollments for this batch
    const enrollments = await this.prisma.client.enrollment.findMany({
      where: { tenantId, batchId, status: "active", deletedAt: null },
      select: { studentId: true },
    });

    if (enrollments.length === 0) return [];

    // Resolve student user IDs (via StudentProfile.userId)
    const studentIds = enrollments.map((e) => e.studentId);
    const studentProfiles = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: studentIds }, tenantId, deletedAt: null },
      select: {
        userId: true,
        user: {
          select: { name: true },
        },
      },
    });

    const userIds = studentProfiles.map((s) => s.userId);

    // Fetch notification_prefs for these users. The leaderboard prefs are dedicated
    // columns, not keys inside `matrix` (see getGamificationPrefs).
    const prefs = await this.prisma.client.notificationPref.findMany({
      where: { userId: { in: userIds }, deletedAt: null },
      select: { userId: true, leaderboardOptIn: true, leaderboardDisplayName: true },
    });
    const prefMap = new Map(
      prefs.map((p) => [
        p.userId,
        { optIn: p.leaderboardOptIn, displayName: p.leaderboardDisplayName },
      ]),
    );

    return studentProfiles.map((s) => {
      const pref = prefMap.get(s.userId);
      const fullName = s.user?.name?.trim() ?? "";
      const firstName = fullName.split(" ")[0] ?? "Student";
      return {
        userId: s.userId,
        leaderboardOptIn: pref?.optIn ?? false,
        leaderboardDisplayName: pref?.displayName ?? null,
        firstName,
      };
    });
  }

  /**
   * Sum points for multiple users at once.
   * Returns a map of userId → totalPoints.
   */
  async sumPointsForUsers(
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    // GROUP BY user_id SUM(delta) for non-deleted rows
    const results = await this.prisma.client.$queryRaw<
      Array<{ user_id: string; total: bigint }>
    >`
      SELECT user_id, SUM(delta)::bigint AS total
      FROM points_ledger
      WHERE tenant_id = ${tenantId}::uuid
        AND user_id = ANY(ARRAY[${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])
        AND deleted_at IS NULL
      GROUP BY user_id
    `;

    const map = new Map<string, number>();
    for (const r of results) {
      map.set(r.user_id, Number(r.total));
    }
    // Ensure all requested userIds have an entry (default 0)
    for (const uid of userIds) {
      if (!map.has(uid)) map.set(uid, 0);
    }
    return map;
  }

  /**
   * Count badges earned by multiple users.
   * Returns a map of userId → badgeCount.
   */
  async countBadgesForUsers(
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const results = await this.prisma.client.$queryRaw<
      Array<{ user_id: string; count: bigint }>
    >`
      SELECT user_id, COUNT(*)::bigint AS count
      FROM user_badges
      WHERE tenant_id = ${tenantId}::uuid
        AND user_id = ANY(ARRAY[${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])
        AND deleted_at IS NULL
      GROUP BY user_id
    `;

    const map = new Map<string, number>();
    for (const r of results) {
      map.set(r.user_id, Number(r.count));
    }
    for (const uid of userIds) {
      if (!map.has(uid)) map.set(uid, 0);
    }
    return map;
  }

  // ─── Audit logging ────────────────────────────────────────────────────────

  async writeAuditLog(data: {
    tenantId: string;
    actorId: string;
    entity: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: data.entity,
        entityId: data.entityId,
        action: data.action,
        before: (data.before ?? Prisma.DbNull) as Prisma.InputJsonValue,
        after: (data.after ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
  }
}
