// Gamification contracts — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Covers WS-3 (Gamification):
//   - PointsSummaryDto    — aggregate XP total + points breakdown for own-scope view
//   - BadgeDto            — badge catalog entry (from `badges` table)
//   - UserBadgeDto        — awarded badge (from `user_badges` table, joined with BadgeDto)
//   - StreakDto           — current streak length + last-activity date
//   - LeaderboardEntryDto — one entry in the batch leaderboard (PII-minimal, opt-in)
//
// Architecture decisions (LOCKED per docs/specs/phase-6-engagement.md):
//   LOCK-D5: Leaderboard is opt-in and PII-minimal.
//     - LeaderboardEntryDto STRUCTURALLY CANNOT carry: email, phone, enrollmentId,
//       real name (when a custom alias was set), studentId, userId, or any other PII.
//     - Only { rank, displayName, totalPoints } plus an opaque `badgeCount` summary.
//     - This is enforced by a COMPILE-TIME TYPE ASSERTION at the bottom of this file.
//
// Security assertions:
//   1. LeaderboardEntryDto MUST NOT carry email, phone, enrollmentId, studentId,
//      userId, or any PII beyond a display name / alias. Compile-time asserted.
//   2. PointsSummaryDto and UserBadgeDto are own-scope (GET /me/gamification);
//      the backend MUST filter on user_id = currentUser.id.
//
// Gamification model (docs/plans/phase-6.md §2):
//   - `points_ledger`: append-only rows (delta + reason + ref). NEVER mutated.
//     Reversals are negative-delta rows (AC-48).
//   - `user_badges`: partial-unique (user_id, badge_id) — one award per badge (AC-46).
//   - Leaderboard: cached projection (TTL 60 s, docs/04 §2.7). Opt-out reflected
//     within the cache TTL (AC-51).
//   - Streaks: derived from daily activity events (no separate DB table in schema;
//     computed on the fly or from a cached projection).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// BadgeDto — badge catalog entry
// ─────────────────────────────────────────────────────────────────────────

/**
 * A badge catalog entry from the `badges` table.
 * Safe for both own-scope (student view) and leaderboard-adjacent display.
 * Does NOT carry any tenant internals beyond the display fields.
 */
export const BadgeDtoSchema = z
  .object({
    id: UuidSchema.describe("Badge catalog ID."),
    /** Unique per-tenant key, e.g. 'first_project_approved', 'perfect_attendance'. */
    key: z.string().min(1).max(64).describe("Stable badge identifier key."),
    name: z.string().min(1).max(128).describe("Display name, e.g. 'First Project Approved'."),
    description: z.string().max(512).describe("Short description shown on the badge card."),
    /** Icon identifier (e.g. a design-system icon key or CDN URL). */
    icon: z.string().min(1).describe("Icon identifier for rendering the badge."),
  })
  .strict();
export type BadgeDto = z.infer<typeof BadgeDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// UserBadgeDto — an awarded badge instance (user_badges table row + joined badge)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A user's earned badge instance. Returned in GET /me/gamification → badges array.
 * The badge catalog detail is joined for display purposes.
 * Own-scope: user_id is derived from session, never from the request body.
 */
export const UserBadgeDtoSchema = z
  .object({
    id: UuidSchema.describe("user_badges row ID."),
    /** The badge catalog entry. */
    badge: BadgeDtoSchema,
    /** ISO-8601 datetime when this badge was awarded. */
    awardedAt: IsoDateTimeSchema.describe("When the badge was awarded to this user."),
    /**
     * Source event reference — the domain event ref that triggered the award.
     * Opaque to the frontend; used for deduplication (partial-unique key with user_id + badge_id).
     */
    ref: z.string().nullable().describe("Source event ref for idempotency tracking. Opaque."),
  })
  .strict();
export type UserBadgeDto = z.infer<typeof UserBadgeDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// StreakDto — daily activity streak
// ─────────────────────────────────────────────────────────────────────────

/**
 * The student's current learning streak state.
 * Derived from daily lesson-completed / assessment-passed events.
 * Returned in GET /me/gamification → streak.
 */
export const StreakDtoSchema = z
  .object({
    /** Current consecutive-day streak length. 0 if the student had no activity yesterday. */
    currentDays: z.number().int().min(0).describe("Current consecutive streak in days."),
    /** Longest streak the student has ever achieved. */
    longestDays: z.number().int().min(0).describe("All-time longest streak in days."),
    /**
     * ISO-8601 date of the most recent activity that contributed to the streak.
     * Null if the student has never completed any learning activity.
     */
    lastActivityAt: IsoDateTimeSchema.nullable().describe("Last activity that extended the streak."),
    /** Whether the streak is currently active (last activity was today or yesterday). */
    isActive: z.boolean().describe("True if the streak is still running (activity yesterday or today)."),
  })
  .strict();
export type StreakDto = z.infer<typeof StreakDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PointsSummaryDto — aggregate XP view for own-scope GET /me/gamification
// ─────────────────────────────────────────────────────────────────────────

/**
 * A student's full gamification summary.
 * Returned by GET /api/v1/me/gamification.
 *
 * `totalPoints` = SUM(points_ledger.delta) for the current user (AC-49).
 * Includes negative deltas (reversals); display floor = 0 in the UI if desired.
 *
 * Own-scope: the backend MUST filter points_ledger on user_id = currentUser.id.
 * Student T's data MUST NOT appear in Student S's response (AC-49).
 */
export const PointsSummaryDtoSchema = z
  .object({
    /**
     * Total XP points: SUM of all non-deleted points_ledger.delta rows.
     * May include negative deltas from reversals. Display floor of 0 is a UI concern.
     */
    totalPoints: z.number().int().describe("Total XP points (sum of ledger deltas, incl. reversals)."),
    /** All badges earned by this user (joined with badge catalog). */
    badges: z.array(UserBadgeDtoSchema).describe("Earned badges, newest first."),
    /** Current streak state. */
    streak: StreakDtoSchema,
    /**
     * Whether this student opts into the batch leaderboard.
     * Stored in notification_prefs.leaderboard_opt_in.
     */
    leaderboardOptIn: z.boolean().describe("Whether this student appears on the leaderboard."),
    /**
     * The display name or alias shown on the leaderboard (when opted in).
     * Null = use first name only. NEVER email or phone.
     */
    leaderboardDisplayName: z.string().nullable().describe("Leaderboard alias. Null = first name only."),
  })
  .strict();
export type PointsSummaryDto = z.infer<typeof PointsSummaryDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// LeaderboardEntryDto — one entry in the batch leaderboard
//
// LOCK-D5 (docs/specs/phase-6-engagement.md): PII-minimal. This DTO is
// the ONLY shape returned by GET /batches/:id/leaderboard.
//
// HARD CONSTRAINTS (compile-time asserted below):
//   - MUST NOT carry: email, phone, enrollmentId, studentId, userId, realName.
//   - ONLY allowed: rank, displayName, totalPoints, badgeCount.
//   - `displayName` is the alias/first-name the student chose when opting in.
//     When no alias is set, the backend uses firstName only (NOT full name).
// ─────────────────────────────────────────────────────────────────────────

/**
 * A single entry on the batch leaderboard.
 *
 * SECURITY / PII GUARANTEE (LOCK-D5, AC-50):
 *   This DTO STRUCTURALLY CANNOT carry email, phone, enrollmentId, studentId,
 *   userId, or any PII beyond a display name / alias. The compile-time assertion
 *   below guarantees this at the TypeScript level.
 *
 * The backend:
 *   1. Only includes students where leaderboard_opt_in = true (AC-50).
 *   2. Uses displayName (alias or firstName only) — never fullName, email, phone (AC-50).
 *   3. Opt-out removes the entry within cache TTL (default 60 s) (AC-51).
 *   4. Returns 404 for non-enrolled students requesting the leaderboard (AC-52).
 */
export const LeaderboardEntryDtoSchema = z
  .object({
    /** 1-based rank position on the leaderboard. */
    rank: z.number().int().min(1).describe("Rank position (1 = top)."),
    /**
     * Display name or alias. Set by the student when opting in.
     * When no alias: first name only (NEVER full name, NEVER email, NEVER phone).
     * Max 64 chars — matching notification_prefs.leaderboard_display_name constraint.
     */
    displayName: z
      .string()
      .min(1)
      .max(64)
      .describe("Student's chosen alias or first name only. NEVER email, phone, or full name."),
    /** Total XP points (sum of non-deleted points_ledger.delta rows for this user). */
    totalPoints: z.number().int().describe("Total XP points for ranking."),
    /** Number of badges earned — a summary count (NOT the badge list with IDs). */
    badgeCount: z.number().int().min(0).describe("Count of earned badges (summary only)."),
    /**
     * True on the CALLER's own row, so the client can highlight it.
     *
     * This is the only way to identify "me" in a list that deliberately carries no user
     * id, and it discloses nothing: it is a fact about the person already holding the
     * session, never about anyone else. Without it the LMS had no honest option — it
     * stamped the current user's id onto EVERY row and the table highlighted the whole
     * leaderboard as "you".
     */
    isMe: z.boolean().describe("True for the requesting student's own row. Never reveals anyone else's identity."),
  })
  .strict();
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntryDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Gamification prefs update input — PUT /me/gamification/prefs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Input for PUT /api/v1/me/gamification/prefs — update leaderboard opt-in.
 * Own-scope: userId derived from session, never from request body (AC-51).
 */
export const UpdateGamificationPrefsDtoSchema = z
  .object({
    /**
     * Whether to appear on the batch leaderboard.
     * Setting to false removes the student from the leaderboard within TTL (AC-51).
     */
    leaderboardOptIn: z.boolean().describe("Set to false to opt out of the leaderboard."),
    /**
     * Alias or display name for the leaderboard.
     * Null removes the alias (reverts to first-name-only display).
     */
    leaderboardDisplayName: z
      .string()
      .min(1)
      .max(64)
      .nullable()
      .optional()
      .describe("Leaderboard alias. Null = use first name only."),
  })
  .strict();
export type UpdateGamificationPrefsDto = z.infer<typeof UpdateGamificationPrefsDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time type assertions — LeaderboardEntryDto MUST be PII-minimal
//
// Hard requirement (LOCK-D5, docs/plans/phase-6.md task #2, AC-50):
//   LeaderboardEntryDto CANNOT structurally contain any of these PII fields.
//   If any are accidentally added, the assignment below fails to compile.
// ─────────────────────────────────────────────────────────────────────────

/** All PII field names that must NEVER appear in LeaderboardEntryDto. */
type ForbiddenLeaderboardPiiField =
  | "email"
  | "phone"
  | "enrollmentId"
  | "studentId"
  | "userId"
  | "realName"
  | "fullName"
  | "lastName"
  | "firstName"
  | "nationalId"
  | "dateOfBirth";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "PII FIELD DETECTED IN LEADERBOARD DTO" : "ok",
] extends ["ok"]
  ? true
  : never;

// This must evaluate to `true`. A `never` → compile error → PII leak caught at build time.
type _AssertLeaderboardNoPii = AssertNoForbiddenFields<
  LeaderboardEntryDto,
  ForbiddenLeaderboardPiiField
>;

const _assertLeaderboard: _AssertLeaderboardNoPii = true;
export type { _AssertLeaderboardNoPii };
void _assertLeaderboard;

// Additional: PointsSummaryDto and UserBadgeDto must not carry provider secrets.
type ForbiddenSecretField = "apiKey" | "webhookSecret" | "signingSecret" | "rawSecret";

type _AssertPointsSummaryNoSecret = AssertNoForbiddenFields<PointsSummaryDto, ForbiddenSecretField>;
type _AssertUserBadgeNoSecret = AssertNoForbiddenFields<UserBadgeDto, ForbiddenSecretField>;

const _assertPointsSummary: _AssertPointsSummaryNoSecret = true;
const _assertUserBadge: _AssertUserBadgeNoSecret = true;
export type { _AssertPointsSummaryNoSecret, _AssertUserBadgeNoSecret };
void _assertPointsSummary;
void _assertUserBadge;
