// apps/api/src/modules/lesson-notes/dto/index.ts
//
// Re-exports the Phase-9 Completion Lesson Notes zod schemas from @repo/types
// (docs/04-trd-architecture.md §2.2 module template). Never redeclare a shape here —
// single source of truth stays in packages/types/src/lms/lesson-notes.schemas.ts.

export {
  CreateLessonNoteRequestSchema,
  type CreateLessonNoteRequest,
  UpdateLessonNoteRequestSchema,
  type UpdateLessonNoteRequest,
  ListLessonNotesQuerySchema,
  type ListLessonNotesQuery,
  LessonNoteSchema,
  type LessonNote,
} from "@repo/types";
