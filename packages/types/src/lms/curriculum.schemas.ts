// LMS Curriculum contracts (student consumption) — Phase 3, Wave 2.
//
// The curriculum tree a student sees when they open an enrolled program:
//   program → modules (ordered) → lessons (ordered)
//
// With per-lesson student-progress state (status, last_position_s, completed_at)
// and a `locked` flag baked in by the server.
//
// LOCKED FLAG SEMANTICS (enforced server-side):
//   locked = the lesson is NOT accessible to the requesting student.
//   For enrolled students: all lessons are unlocked by default in P3
//   (no sequential-completion locking in P3 scope; that is a future feature).
//   `is_preview=true` lessons are always unlocked (pre-enrollment viewable).
//   The server is the authoritative gate: the UI must render "locked" whenever
//   the API returns `locked: true` — never trust client-side state.
//
// ENROLLMENT GATE:
//   `GET /api/v1/me/enrollments/:id/curriculum` is enrollment-gated:
//     - The student must have an active enrollment in the program.
//     - Non-enrolled students get 403 (or 404 per the plan's hide-or-deny policy).
//     - Preview lessons (`is_preview=true`) are viewable without enrollment through
//       `GET /api/v1/lessons/:id` but NOT through this curriculum endpoint.
//
// NO RAW VIDEO URLS HERE. `hasVideo` and `durationS` are metadata only.
// To get a playable stream URL call `GET /api/v1/lessons/:id/stream-url`.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// Per-lesson progress snapshot (embedded in curriculum nodes)
// ─────────────────────────────────────────────────────────────────────────

export const LessonProgressStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
export type LessonProgressStatus = z.infer<typeof LessonProgressStatusSchema>;

/**
 * Snapshot of a student's progress on one lesson, embedded inside the
 * curriculum tree node. Null when no progress row exists yet (= not started).
 */
export const LessonProgressSnapshotSchema = z.object({
  status: LessonProgressStatusSchema,
  lastPositionS: z.number().int().min(0).describe("Last known video position in seconds (0 = start)."),
  completedAt: IsoDateTimeSchema.nullable(),
});
export type LessonProgressSnapshot = z.infer<typeof LessonProgressSnapshotSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Curriculum lesson node (tree leaf)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A lesson node in the student-facing curriculum tree.
 *
 * Intentionally minimal — content body is NOT included (fetched per-lesson
 * via `GET /lessons/:id`), same pattern as the CRM curriculum builder
 * (`crm/courses.schemas.ts LessonNodeSchema`), to keep the tree payload
 * small for accordion UIs.
 *
 * `hasVideo`  — true when a ready `videos` row exists for this lesson.
 * `durationS` — from `videos.duration_s`; null if no video or not yet ready.
 * `locked`    — true when the student cannot access this lesson (server-set).
 *               Always false in P3 for enrolled students; reserved for future
 *               sequential-completion locking or non-enrollment scenarios.
 * `progress`  — null when the student has never started this lesson.
 */
export const CurriculumLessonNodeSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  type: z.enum(["video", "reading", "assignment", "quiz"]),
  order: z.number().int().min(0),
  isPreview: z.boolean(),
  locked: z.boolean().describe(
    "Server-set: true when the student cannot access this lesson. " +
    "The UI must render a locked affordance and must NOT allow navigation. " +
    "Locked lessons return 403 from all content endpoints.",
  ),
  hasVideo: z.boolean().describe("True when a ready `videos` row exists for this lesson."),
  durationS: z.number().int().min(0).nullable().describe(
    "Video duration in seconds from `videos.duration_s`. Null if no video or not yet ready.",
  ),
  captionsAvailable: z.boolean().describe(
    "True when a `videos.captions` payload exists for this lesson (accessibility, docs/02 §15).",
  ),
  progress: LessonProgressSnapshotSchema.nullable().describe(
    "The student's progress snapshot for this lesson. Null = not started.",
  ),
});
export type CurriculumLessonNode = z.infer<typeof CurriculumLessonNodeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Curriculum module node (tree branch)
// ─────────────────────────────────────────────────────────────────────────

/** Module rollup stats for the progress display in the accordion header. */
export const ModuleProgressRollupSchema = z.object({
  lessonsTotal: z.number().int().min(0),
  lessonsCompleted: z.number().int().min(0),
  progressPct: z.number().int().min(0).max(100),
});
export type ModuleProgressRollup = z.infer<typeof ModuleProgressRollupSchema>;

export const CurriculumModuleNodeSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  order: z.number().int().min(0),
  lessons: z.array(CurriculumLessonNodeSchema),
  progress: ModuleProgressRollupSchema,
});
export type CurriculumModuleNode = z.infer<typeof CurriculumModuleNodeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Full curriculum response
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/me/enrollments/:id/curriculum → data field.
 *
 * Enrollment-gated: the enrollment id in the path MUST belong to the
 * authenticated student and have status=active. Returns 403 otherwise.
 *
 * The tree is ordered by `module.order` then `lesson.order` as set by CRM
 * authors. Lesson content bodies are NOT included — call `GET /lessons/:id`
 * for the full detail of a specific lesson.
 */
export const CurriculumResponseSchema = z.object({
  enrollmentId: UuidSchema,
  programId: UuidSchema,
  programTitle: z.string(),
  programSlug: z.string(),
  modules: z.array(CurriculumModuleNodeSchema),
  totalLessons: z.number().int().min(0),
  completedLessons: z.number().int().min(0),
  progressPct: z.number().int().min(0).max(100),
});
export type CurriculumResponse = z.infer<typeof CurriculumResponseSchema>;
