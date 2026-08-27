// LMS Progress contracts — Phase 3, Wave 2 (docs/plans/phase-3.md task #2).
//
// Two write endpoints + two read endpoints for the student's own progress:
//
//   PUT  /api/v1/me/lessons/:id/progress  — position ping (UpdateProgressRequest)
//   POST /api/v1/me/lessons/:id/complete  — mark lesson complete (MarkLessonCompleteRequest)
//   GET  /api/v1/me/progress              — per-program/module rollup (MyProgressResponse)
//   GET  /api/v1/me/progress/lessons      — raw per-lesson progress list (optional P3 read)
//
// ENROLLMENT SCOPE: all writes require an active enrollment in the lesson's program
// (resolved by the backend from `lesson → module → program → enrollments`). The
// student CANNOT write progress for a lesson they are not enrolled in, and CANNOT
// write for another student. Permission: `progress.write` (scope: own).
//
// POSITION PING semantics:
//   - The player calls PUT /me/lessons/:id/progress on a throttled onTimeUpdate
//     interval (e.g. every 5–10 s) with the current playback position.
//   - The server upserts `lesson_progress (enrollment_id, lesson_id)`.
//   - The client sends ONLY `lastPositionS` (and optionally `status`).
//   - The client CANNOT directly set `status=completed` via this endpoint —
//     completion is triggered by POST /me/lessons/:id/complete (a separate action).
//   - Rationale: separating "ping" from "complete" prevents accidental completion
//     via a stale position report and makes the completion event explicit and auditable.
//
// COMPLETION semantics:
//   - POST /me/lessons/:id/complete is the explicit completion action.
//   - The server sets `status=completed`, `completed_at=now()`, and:
//       1. Rolls up `enrollment.progress_pct` (completed/total lessons × 100).
//       2. Idempotently creates one `attendance` row (source=recorded) for
//          the (enrollment, lesson) pair. Replay does NOT double-count.
//       3. Writes an audit-log row.
//   - Idempotent: calling complete on an already-completed lesson is a no-op
//     (returns the current progress row; does not re-mark attendance).
//
// VALIDATION:
//   - `lastPositionS` must be ≥ 0 (non-negative integer seconds).
//   - No upper-bound validation on `lastPositionS` here (the video duration may
//     not be known if the video is still processing); the backend may clamp to
//     `videos.duration_s` if known.
//   - The student cannot set `enrollmentId`, `lessonId`, `tenantId`, or `status`
//     directly — these are resolved/set server-side.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { LessonProgressStatusSchema } from "./curriculum.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Write requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/v1/me/lessons/:id/progress — position ping.
 *
 * The player sends this on a throttled interval during playback.
 * Keeps `lastPositionS` up to date for resume-where-you-left-off (±2s,
 * docs/02 §21). Optionally allows signalling `in_progress` status explicitly
 * (the server will also infer it), but does NOT allow setting `completed` —
 * use POST /me/lessons/:id/complete for that.
 *
 * The lessonId is in the path; no body field for it (prevents over-posting).
 */
export const UpdateProgressRequestSchema = z
  .object({
    lastPositionS: z
      .number()
      .int()
      .min(0, "lastPositionS must be ≥ 0")
      .describe(
        "Current playback position in seconds. Must be ≥ 0. " +
        "The backend may clamp this to videos.duration_s if known. " +
        "The server uses this for resume-where-you-left-off (±2s per docs/02 §21).",
      ),
  })
  .strict()
  .describe(
    "Position ping. Only carries lastPositionS. The student cannot set " +
    "status=completed here; use POST /me/lessons/:id/complete for completion.",
  );
export type UpdateProgressRequest = z.infer<typeof UpdateProgressRequestSchema>;

/**
 * POST /api/v1/me/lessons/:id/complete — explicit lesson completion.
 *
 * Empty body action — the lesson to complete is identified by the path param `:id`.
 * The server:
 *   1. Sets lesson_progress.status=completed, completed_at=now().
 *   2. Rolls up enrollment.progress_pct.
 *   3. Idempotently marks attendance (source=recorded) — replay is a no-op.
 *   4. Writes an audit-log row.
 *
 * Idempotency-Key header is REQUIRED on this endpoint (docs/04 §2.14 — unsafe mutation).
 * Replayed requests with the same key return the cached ProgressResponse without
 * double-counting attendance or corrupting the rollup.
 */
export const MarkLessonCompleteRequestSchema = z
  .object({})
  .strict()
  .describe(
    "Empty body. The lessonId is in the path. Idempotency-Key header required. " +
    "Idempotent: replaying on an already-completed lesson is a no-op (no double-attendance).",
  );
export type MarkLessonCompleteRequest = z.infer<typeof MarkLessonCompleteRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Single-lesson progress response
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returned by both PUT /me/lessons/:id/progress and POST /me/lessons/:id/complete.
 * Reflects the current state of `lesson_progress` after the write.
 */
export const ProgressResponseSchema = z.object({
  lessonId: UuidSchema,
  enrollmentId: UuidSchema,
  status: LessonProgressStatusSchema,
  lastPositionS: z.number().int().min(0).describe("Updated position; use this for resume seek."),
  completedAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
  /** Partial rollup of the enrollment's overall progress — allows the UI to update
   *  the progress ring without a separate GET /me/progress call after each ping. */
  enrollmentProgressPct: z.number().int().min(0).max(100).describe(
    "The enrollment's recalculated progress_pct after this write. " +
    "Useful for optimistic UI updates of the progress ring.",
  ),
});
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Progress rollup (GET /api/v1/me/progress)
// ─────────────────────────────────────────────────────────────────────────

/** Per-module progress breakdown within a program. */
export const ModuleProgressSchema = z.object({
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  order: z.number().int().min(0),
  lessonsTotal: z.number().int().min(0),
  lessonsCompleted: z.number().int().min(0),
  progressPct: z.number().int().min(0).max(100),
});
export type ModuleProgress = z.infer<typeof ModuleProgressSchema>;

/** Per-program progress rollup including module breakdowns. */
export const ProgramProgressDetailSchema = z.object({
  enrollmentId: UuidSchema,
  programId: UuidSchema,
  programTitle: z.string(),
  programSlug: z.string(),
  lessonsTotal: z.number().int().min(0),
  lessonsCompleted: z.number().int().min(0),
  progressPct: z.number().int().min(0).max(100),
  status: z.enum(["active", "completed", "dropped"]),
  modules: z.array(ModuleProgressSchema),
});
export type ProgramProgressDetail = z.infer<typeof ProgramProgressDetailSchema>;

/**
 * GET /api/v1/me/progress → data field.
 *
 * Per-program/module completion rollup for all of the student's active enrollments.
 * Used to render the My Progress analytics view (progress rings + module breakdown,
 * docs/02 §7.10). Permission: `progress.write` (read also allowed, scope: own).
 */
export const MyProgressResponseSchema = z.object({
  programs: z.array(ProgramProgressDetailSchema),
  overallLessonsCompleted: z.number().int().min(0),
  overallLessonsTotal: z.number().int().min(0),
  overallProgressPct: z.number().int().min(0).max(100).describe(
    "Aggregate completion % across all active enrollments. " +
    "completedLessons_across_all_programs / totalLessons_across_all_programs × 100.",
  ),
});
export type MyProgressResponse = z.infer<typeof MyProgressResponseSchema>;

// ── The one definition of course completion ───────────────────────────────────────────

/**
 * Course progress, computed from lesson counts. THE single definition — API and both
 * frontends call this rather than each rounding their own percentage, the same way
 * `computeLeaveDuration` (P13) and `summariseTargetMetric` (P15) are single definitions.
 *
 * Progress is DERIVED, never a number somebody remembered. `enrollment.progress_pct` is a
 * cache of this function's output, resynced whenever either side of the fraction moves —
 * including when the DENOMINATOR moves. That last case is what went wrong in production:
 * the rollup was written only on lesson completion, on the stated assumption that "lessons
 * are never un-completed". True of the numerator, and irrelevant to the denominator. A
 * student finished a programme at 100%, staff added a module, and the enrollment kept
 * saying "Completed" at 100% on every screen that read the stored column while every screen
 * that recomputed it said 98%.
 */
export interface CourseProgressSummary {
  lessonsTotal: number;
  lessonsCompleted: number;
  /** What is left to do. Zero when there are no lessons at all, not when nothing is done. */
  lessonsPending: number;
  /** 0-100, integer. A programme with no lessons yet is 0%, never 100%. */
  progressPct: number;
  /**
   * Whether the student has actually finished. Note this is `pct === 100`, NOT `pct >= 100`
   * of a rounded number: 199 of 200 lessons rounds to 100% and is not complete, so the
   * rounding is done on a value that is already known to be short.
   */
  isComplete: boolean;
}

export function summariseCourseProgress(
  lessonsCompleted: number,
  lessonsTotal: number,
): CourseProgressSummary {
  const total = Math.max(0, Math.trunc(lessonsTotal));
  // Completed can exceed total for a moment if a lesson is removed after being finished;
  // clamping keeps the fraction honest instead of reporting 104%.
  const completed = Math.min(Math.max(0, Math.trunc(lessonsCompleted)), total);
  const isComplete = total > 0 && completed >= total;
  return {
    lessonsTotal: total,
    lessonsCompleted: completed,
    lessonsPending: total - completed,
    // Short of the finish line never rounds up to 100 — a card reading "100%" beside a
    // "Continue learning" button is the contradiction this whole helper exists to prevent.
    progressPct: total === 0 ? 0 : isComplete ? 100 : Math.min(99, Math.round((completed / total) * 100)),
    isComplete,
  };
}
