// apps/api/src/modules/faculty/dto/index.ts
//
// Re-exports the faculty zod schemas from @repo/types (docs/04-trd-architecture.md §2.2
// module template). Single source of truth stays in the shared package.

export {
  CreateFacultyRequestSchema,
  type CreateFacultyRequest,
  UpdateFacultyRequestSchema,
  type UpdateFacultyRequest,
  ListFacultyQuerySchema,
  type ListFacultyQuery,
  RestoreFacultyRequestSchema,
  type RestoreFacultyRequest,
  type FacultySummary,
  type FacultyDetail,
  type FacultyResetPasswordResponse,
} from "@repo/types";
