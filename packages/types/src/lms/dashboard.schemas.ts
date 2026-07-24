// LMS Dashboard contracts — Phase 3, Wave 2 (docs/plans/phase-3.md task #2).
//
// Shapes the student-facing dashboard: my enrollments summary, the
// "continue-learning" rail (resume the last-watched lesson at its timestamp),
// per-program progress rollups, and upcoming unwatched lessons.
//
// STUDENT-FACING: every datum here is scoped to the requesting student's OWN
// enrollments. The backend resolves the student id from the session — the client
// never sends a studentId. Permission: `courses.view` (scope: own).
//
// Live-class countdown is OUT of P3 (live deferred — docs/plans/phase-3.md §Risks #4).
// A graceful empty affordance replaces it in the UI.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// Enrollment summary (lightweight — dashboard cards + list)
// ─────────────────────────────────────────────────────────────────────────

/** Minimal enrollment card shown on the dashboard grid and My Courses list. */
export const EnrollmentCardSchema = z.object({
  enrollmentId: UuidSchema.describe("The student's enrollment id."),
  programId: UuidSchema,
  programTitle: z.string(),
  programSlug: z.string(),
  programImageUrl: z.string().nullable().describe("Public CDN cover image URL, or null when none uploaded."),
  batchId: UuidSchema,
  batchName: z.string(),
  status: z.enum(["active", "completed", "dropped"]),
  progressPct: z.number().int().min(0).max(100).describe("Completion % (completed lessons / total lessons)."),
  enrolledAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
});
export type EnrollmentCard = z.infer<typeof EnrollmentCardSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Continue-learning rail item
// ─────────────────────────────────────────────────────────────────────────

/**
 * The single most-recent in-progress lesson the student should resume.
 * Null when the student has no in-progress lesson (e.g. first login or
 * all lessons completed). `lastPositionS` is the seconds position the
 * player must seek to on resume (±2s per docs/02 §21).
 *
 * NOTE: carries NO video URL — the player calls
 * `GET /api/v1/lessons/:lessonId/stream-url` separately on play.
 * This DTO is pure navigation metadata, not a streaming credential.
 */
export const ContinueLearningItemSchema = z.object({
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  lessonType: z.enum(["video", "reading", "assignment", "quiz"]),
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  enrollmentId: UuidSchema,
  lastPositionS: z.number().int().min(0).describe("Resume seek position in seconds. 0 = start."),
  durationS: z.number().int().min(0).nullable().describe("Total lesson duration in seconds, null if not yet known (video still processing)."),
  progressStatus: z.enum(["not_started", "in_progress", "completed"]),
  updatedAt: IsoDateTimeSchema.describe("When lesson_progress was last updated — used to pick the most recent."),
});
export type ContinueLearningItem = z.infer<typeof ContinueLearningItemSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Upcoming lessons (next unwatched in each enrolled program)
// ─────────────────────────────────────────────────────────────────────────

/** A single upcoming (not-started) lesson item surfaced on the dashboard. */
export const UpcomingLessonItemSchema = z.object({
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  lessonType: z.enum(["video", "reading", "assignment", "quiz"]),
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  enrollmentId: UuidSchema,
  order: z.number().int().min(0).describe("Lesson order within its module."),
  durationS: z.number().int().min(0).nullable(),
  hasVideo: z.boolean(),
});
export type UpcomingLessonItem = z.infer<typeof UpcomingLessonItemSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Overall progress summary (per-program completion rings)
// ─────────────────────────────────────────────────────────────────────────

export const ProgramProgressSummarySchema = z.object({
  enrollmentId: UuidSchema,
  programId: UuidSchema,
  programTitle: z.string(),
  progressPct: z.number().int().min(0).max(100),
  lessonsCompleted: z.number().int().min(0),
  lessonsTotal: z.number().int().min(0),
  status: z.enum(["active", "completed", "dropped"]),
});
export type ProgramProgressSummary = z.infer<typeof ProgramProgressSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Dashboard response (GET /api/v1/me/dashboard)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/me/dashboard → data field.
 *
 * Aggregated dashboard snapshot for the authenticated student. All data is the
 * student's OWN — no other student's data is present (enforced server-side,
 * `courses.view scope:own`).
 *
 * - `enrollments`: lightweight cards for every active enrollment (the "My Courses" grid).
 * - `continueLearning`: the single most-recent in-progress lesson (null if none).
 * - `progressSummary`: per-program completion rings (same set as `enrollments`).
 * - `upcomingLessons`: the next unwatched lesson from each enrolled program (capped server-side).
 * - `totalEnrollments` / `totalCompleted`: aggregate counts for the summary bar.
 */
export const MeDashboardResponseSchema = z.object({
  enrollments: z.array(EnrollmentCardSchema),
  continueLearning: ContinueLearningItemSchema.nullable().describe(
    "Most-recent in-progress lesson to resume. Null if no lesson is in-progress. " +
    "No video URL here — call GET /lessons/:id/stream-url on play.",
  ),
  progressSummary: z.array(ProgramProgressSummarySchema).describe(
    "Per-program completion rings; same programs as `enrollments`.",
  ),
  upcomingLessons: z.array(UpcomingLessonItemSchema).describe(
    "The next unwatched lesson per enrolled program, capped by the server (typically ≤10).",
  ),
  totalEnrollments: z.number().int().min(0),
  totalCompleted: z.number().int().min(0).describe("Enrollments with status=completed."),
});
export type MeDashboardResponse = z.infer<typeof MeDashboardResponseSchema>;
