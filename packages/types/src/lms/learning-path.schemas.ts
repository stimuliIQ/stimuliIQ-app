// Learning path contract — Phase 9 Completion, T14/T35. GET /api/v1/me/learning-path —
// the student's own recommended next-step sequence across their active enrollments,
// derived server-side from lesson_progress/enrollments (same "live read, never a
// parallel progress table" posture as the mentor completion rollup,
// crm/mentors.schemas.ts BatchCompletionSummaryDto). Own-scope only.

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";
import { LessonProgressStatusSchema } from "./curriculum.schemas.js";

export const LearningPathStepSchema = z.object({
  enrollmentId: UuidSchema,
  programId: UuidSchema,
  programTitle: z.string(),
  moduleId: UuidSchema,
  moduleTitle: z.string(),
  lessonId: UuidSchema,
  lessonTitle: z.string(),
  status: LessonProgressStatusSchema,
  isNextUp: z.boolean().describe("True for the single lesson the UI should highlight as 'continue learning' per enrollment."),
});
export type LearningPathStep = z.infer<typeof LearningPathStepSchema>;

/** GET /api/v1/me/learning-path response — one ordered step list per active enrollment. */
export const LearningPathResponseSchema = z.object({
  steps: z.array(LearningPathStepSchema),
});
export type LearningPathResponse = z.infer<typeof LearningPathResponseSchema>;
