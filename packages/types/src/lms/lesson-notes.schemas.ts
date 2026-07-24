// Lesson notes contract — Phase 9 Completion, T10/T14/T29. Backs `model LessonNote` —
// a student's personal note on a lesson, optionally anchored to a video timestamp.
// Own-scope CRUD under /api/v1/me/lessons/:lessonId/notes(/:noteId).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

/** POST /api/v1/me/lessons/:lessonId/notes */
export const CreateLessonNoteRequestSchema = z
  .object({
    body: z.string().min(1).max(4000),
    timestampS: z.number().int().min(0).optional(),
  })
  .strict();
export type CreateLessonNoteRequest = z.infer<typeof CreateLessonNoteRequestSchema>;

/** PATCH /api/v1/me/lessons/:lessonId/notes/:noteId */
export const UpdateLessonNoteRequestSchema = CreateLessonNoteRequestSchema.partial().strict();
export type UpdateLessonNoteRequest = z.infer<typeof UpdateLessonNoteRequestSchema>;

/** GET /api/v1/me/lessons/:lessonId/notes */
export const ListLessonNotesQuerySchema = PageQuerySchema.strict();
export type ListLessonNotesQuery = z.infer<typeof ListLessonNotesQuerySchema>;

export const LessonNoteSchema = z.object({
  id: UuidSchema,
  lessonId: UuidSchema,
  body: z.string(),
  timestampS: z.number().int().min(0).nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LessonNote = z.infer<typeof LessonNoteSchema>;
